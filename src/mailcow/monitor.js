// -----------------------------------------------------------------------------
// The refresh loop: read the server, tell Gladys.
//
// Every `poll_frequency` seconds (and on demand: the "Refresh now" button, a
// scene, a widget), one snapshot of the server is read, then:
//   - the device list is published again when it changed (a domain added in
//     mailcow shows up in the Discovery tab);
//   - the states are published, only the ones that changed (the host API
//     accepts 300 states a minute, sized for changes, not snapshots);
//   - the transport badges say which address answered;
//   - what changed since the previous read fires the scene triggers;
//   - the connection status of the Configuration screen follows;
//   - the dashboard widgets are asked to pull their content again.
//
// One refresh at a time: a request made while one runs gets that one's result
// instead of starting another, so a burst of buttons never doubles the API
// traffic.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import {
  buildDiscoveredDevices,
  buildStates,
  deviceExternalIds,
  findDevice,
  isActiveFeature,
} from '../devices/index.js';
import { MailcowError } from './client.js';
import { diffSnapshots, reachabilityEvent } from './events.js';
import { describeError } from './messages.js';
import { readSnapshot } from './snapshot.js';

const logger = createLogger({ name: 'monitor' });

// An unchanged value is still published every half hour, so it stays recently
// dated in Gladys (and a chart does not show a hole).
const STATE_HEARTBEAT_MS = 30 * 60 * 1000;
// The host API takes at most 100 transport entries per request.
const TRANSPORTS_PER_REQUEST = 100;

export class MailcowMonitor {
  /**
   * @param {object} options
   * @param {import('@gladysassistant/integration-sdk').GladysIntegration} options.gladys
   * @param {import('./client.js').MailcowClient} options.client
   * @param {string[]} [options.widgets] keys of the widgets to nudge after a read
   */
  constructor({ gladys, client, widgets = [] }) {
    this.gladys = gladys;
    this.client = client;
    this.widgets = widgets;
    this.config = null;
    // The last good read, and whether the server answered the last time.
    this.snapshot = null;
    this.reachable = null;
    this.lastError = null;
    this.lastRefreshAt = null;
    this.timer = null;
    this.running = null;
    // Bumped by every configuration: a read started under an older one is
    // not applied.
    this.generation = 0;
    this.runningGeneration = -1;
    // What was last sent, to send it again only when it changes.
    this.publishedDevicesKey = null;
    this.publishedTransportsKey = null;
    this.publishedStatusKey = null;
  }

  /**
   * Apply a (normalized) configuration. Another server, another key or other
   * device options: the next read is a new baseline (no event fires from a
   * comparison with what another configuration read).
   */
  configure(config) {
    this.generation += 1;
    this.config = config;
    this.client.configure(config);
    this.snapshot = null;
    this.reachable = null;
    this.lastError = null;
    this.forgetPublished();
  }

  /** Send everything again at the next read (a reconnection to Gladys). */
  forgetPublished() {
    this.publishedDevicesKey = null;
    this.publishedTransportsKey = null;
    this.publishedStatusKey = null;
  }

  /** Read the server every `poll_frequency` seconds, starting now. */
  start() {
    this.stop();
    const run = () =>
      this.refresh().catch((err) => logger.error('Refresh failed', err?.message ?? err));
    run();
    this.timer = setInterval(run, this.config.poll_frequency * 1000);
    // Never a reason to keep the process alive.
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Read the server once and tell Gladys. Resolves `{ ok, snapshot, error }`;
   * never rejects for an unreachable server, which is a state, not a bug.
   */
  refresh() {
    if (this.running && this.runningGeneration === this.generation) {
      return this.running;
    }
    // A read under the previous configuration may still run: this one starts
    // once it is over, so a saved configuration is always read at once.
    const start = this.running
      ? this.running.catch(() => {}).then(() => this.refreshNow())
      : this.refreshNow();
    const run = start.finally(() => {
      if (this.running === run) {
        this.running = null;
      }
    });
    this.running = run;
    this.runningGeneration = this.generation;
    return run;
  }

  async refreshNow() {
    const { gladys, client, config, generation } = this;
    // The preferred address is tried first again at every read.
    client.resetPreference();
    let snapshot;
    try {
      snapshot = await readSnapshot(client);
    } catch (err) {
      if (generation !== this.generation) {
        return this.staleResult();
      }
      return this.onUnreachable(err);
    }
    if (generation !== this.generation) {
      return this.staleResult();
    }
    const previous = this.snapshot;
    const wasReachable = this.reachable;
    this.snapshot = snapshot;
    this.reachable = true;
    this.lastError = null;
    this.lastRefreshAt = snapshot.at;
    logger.debug(
      `Read mailcow ${snapshot.version ?? '?'} through ${client.transportStatus().transport}`,
    );

    await this.publishDevices();
    try {
      await gladys.publishChangedStates(buildStates(gladys, snapshot, config), {
        heartbeat: STATE_HEARTBEAT_MS,
      });
    } catch (err) {
      // Sent again by the next read: publishChangedStates only remembers what
      // Gladys accepted.
      logger.warn(`Could not publish the states: ${err.message}`);
    }
    await this.publishTransports();
    await this.publishStatus(true);

    const events = diffSnapshots(previous, snapshot, config);
    const restored = reachabilityEvent(wasReachable, true, {
      transport: client.transportStatus().transport,
    });
    if (restored) {
      events.unshift(restored);
    }
    await this.fireEvents(events);
    this.refreshWidgets();
    return { ok: true, snapshot, events };
  }

  /** A read the configuration changed under: nothing of it is applied. */
  staleResult() {
    logger.debug('Configuration changed during the read: result dropped');
    return {
      ok: false,
      error: new MailcowError('The configuration changed during the read', { code: 'stale' }),
    };
  }

  async onUnreachable(err) {
    const error = err instanceof MailcowError ? err : new MailcowError(String(err?.message ?? err));
    const wasReachable = this.reachable;
    this.reachable = false;
    this.lastError = error;
    if (error.code === 'not_configured') {
      logger.info('Waiting for the mailcow address and API key');
    } else {
      logger.warn(`mailcow not read: ${error.message}`);
    }
    // The server device is published anyway, so it can be created and show
    // the server as unreachable.
    await this.publishDevices();
    await this.publishTransports();
    await this.publishStatus(false, describeError(error));
    const lost = reachabilityEvent(wasReachable, false, { error });
    await this.fireEvents(lost ? [lost] : []);
    this.refreshWidgets();
    return { ok: false, error };
  }

  /** The device list, when it changed since it was last published. */
  async publishDevices({ force = false } = {}) {
    const devices = buildDiscoveredDevices(this.gladys, this.snapshot, this.config);
    const key = JSON.stringify(
      devices.map((device) => [device.external_id, device.features.map((f) => f.read_only)]),
    );
    if (!force && key === this.publishedDevicesKey) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.publishedDevicesKey = key;
      logger.info(`${devices.length} device(s) published`);
    } catch (err) {
      logger.warn(`Could not publish the devices: ${err.message}`);
    }
  }

  /** Every state again: a device just created in Gladys has none yet. */
  async republishStates() {
    if (!this.snapshot) {
      return;
    }
    await this.gladys.publishChangedStates(buildStates(this.gladys, this.snapshot, this.config), {
      heartbeat: STATE_HEARTBEAT_MS,
    });
  }

  /** The badge of every device: the same server, the same address. */
  async publishTransports() {
    const status = this.client.transportStatus();
    const ids = deviceExternalIds(this.gladys, this.snapshot, this.config);
    const key = JSON.stringify([status, ids]);
    if (key === this.publishedTransportsKey) {
      return;
    }
    const entries = ids.map((externalId) => ({ external_id: externalId, ...status }));
    try {
      for (let start = 0; start < entries.length; start += TRANSPORTS_PER_REQUEST) {
        await this.gladys.publishTransports(entries.slice(start, start + TRANSPORTS_PER_REQUEST));
      }
      this.publishedTransportsKey = key;
    } catch (err) {
      logger.debug(`Could not publish the transports: ${err.message}`);
    }
  }

  async publishStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.publishedStatusKey) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(connected, message);
      this.publishedStatusKey = key;
    } catch (err) {
      logger.debug(`Could not publish the connection status: ${err.message}`);
    }
  }

  async fireEvents(events) {
    for (const { key, data } of events) {
      logger.info(`Scene event ${key} ${JSON.stringify(data)}`);
      try {
        await this.gladys.publishSceneEvent(key, data);
      } catch (err) {
        logger.warn(`Scene event ${key} not accepted: ${err.message}`);
      }
    }
  }

  refreshWidgets() {
    for (const key of this.widgets) {
      try {
        this.gladys.requestWidgetRefresh(key);
      } catch (err) {
        logger.debug(`Could not refresh the widget ${key}: ${err.message}`);
      }
    }
  }

  // --- Changes (read-write API key, `allow_changes`) ------------------------

  assertChangesAllowed() {
    if (!this.config?.allow_changes) {
      throw new MailcowError('Changes are turned off in the configuration', {
        code: 'changes_disabled',
      });
    }
  }

  /**
   * Gladys flipped the "active" switch of a domain or a mailbox.
   *
   * @param {string} deviceExternalId
   * @param {string} featureExternalId
   * @param {number} value 1 to activate, 0 to deactivate
   */
  async setActive(deviceExternalId, featureExternalId, value) {
    this.assertChangesAllowed();
    const found = findDevice(this.gladys, this.snapshot, this.config, deviceExternalId);
    if (!found?.entry || !isActiveFeature(featureExternalId)) {
      throw new Error(`No command for ${featureExternalId}`);
    }
    const active = Number(value) === 1;
    const [path, body] = found.blueprint.activation(found.entry, active);
    logger.info(
      `${active ? 'Activating' : 'Deactivating'} ${found.blueprint.type} ${body.items[0]}`,
    );
    await this.client.post(path, body);
    found.entry.active = active;
    // Confirmed by mailcow: this is the state of the device now.
    await this.gladys.publishState(featureExternalId, active ? 1 : 0);
  }

  /**
   * Turn a mailbox on or off by its address (scene action). Resolves whether
   * it changed anything.
   */
  async setMailboxActive(address, active) {
    this.assertChangesAllowed();
    const username = String(address ?? '')
      .trim()
      .toLowerCase();
    if (!/^[^@\s]+@[^@\s]+$/.test(username)) {
      throw new MailcowError(`"${address}" is not a mailbox address`, { code: 'api' });
    }
    logger.info(`${active ? 'Activating' : 'Deactivating'} mailbox ${username}`);
    await this.client.post('edit/mailbox', {
      items: [username],
      attr: { active: active ? '1' : '0' },
    });
    const entry = this.snapshot?.mailboxes?.find((mailbox) => mailbox.username === username);
    const changed = entry ? entry.active !== active : true;
    if (entry) {
      entry.active = active;
    }
    await this.republishStates().catch(() => {});
    return changed;
  }

  /**
   * Ask Postfix to deliver the queue now (`postqueue -f`). Resolves the
   * number of mails that were waiting.
   */
  async flushQueue() {
    this.assertChangesAllowed();
    const waiting = this.snapshot?.queue?.total ?? null;
    logger.info('Flushing the mail queue');
    await this.client.post('edit/mailq', { action: 'flush' });
    return waiting;
  }
}
