// -----------------------------------------------------------------------------
// Device type: the MAILCOW SERVER.
//
// One device for the whole server, with the counters an administrator looks
// at first: containers up and down, mails waiting in the queue, mails held in
// quarantine, IPs banned by fail2ban, mail storage, and the mailcow version.
// Read-only: the states come from the snapshot of each refresh (see
// src/mailcow/snapshot.js), so the device is not polled by Gladys.
// -----------------------------------------------------------------------------

import { summaryOf } from '../mailcow/snapshot.js';
import { counter, gigabytes, percent, text } from './features.js';

const DEVICE_TYPE = 'server';

// The integration talks to ONE mailcow server (one configuration per Gladys),
// and the API gives it no id of its own: the server is the server, whatever
// address it is reached by. Never derived from the URL, which the user may
// change without the device becoming another one.
const PLATFORM_ID = 'mailcow';

export const SERVER_FEATURES = {
  CONTAINERS_RUNNING: 'containers-running',
  CONTAINERS_DOWN: 'containers-down',
  QUEUE: 'queue',
  QUARANTINE: 'quarantine',
  BANNED_IPS: 'banned-ips',
  STORAGE_USED: 'storage-used',
  STORAGE_PERCENT: 'storage-percent',
  DOMAINS: 'domains',
  MAILBOXES: 'mailboxes',
  VERSION: 'version',
};

export const server = {
  type: DEVICE_TYPE,

  ids(gladys) {
    return gladys.externalIds(DEVICE_TYPE, PLATFORM_ID);
  },

  buildDevice(gladys) {
    const ids = this.ids(gladys);
    const f = (key) => ids.feature(key);
    return {
      name: 'mailcow server',
      external_id: ids.device,
      features: [
        counter(f(SERVER_FEATURES.CONTAINERS_RUNNING), 'Containers running', 100),
        counter(f(SERVER_FEATURES.CONTAINERS_DOWN), 'Containers down', 100),
        counter(f(SERVER_FEATURES.QUEUE), 'Mail queue', 1_000_000),
        counter(f(SERVER_FEATURES.QUARANTINE), 'Quarantine', 1_000_000),
        counter(f(SERVER_FEATURES.BANNED_IPS), 'Banned IPs', 1_000_000),
        gigabytes(f(SERVER_FEATURES.STORAGE_USED), 'Mail storage used'),
        percent(f(SERVER_FEATURES.STORAGE_PERCENT), 'Mail storage used (%)'),
        counter(f(SERVER_FEATURES.DOMAINS), 'Domains', 100_000),
        counter(f(SERVER_FEATURES.MAILBOXES), 'Mailboxes', 1_000_000),
        text(f(SERVER_FEATURES.VERSION), 'mailcow version'),
      ],
    };
  },

  /**
   * The states of the server, from a snapshot. A section the read could not
   * get publishes nothing (its last value stays) rather than a false zero.
   */
  states(gladys, snapshot) {
    const ids = this.ids(gladys);
    const summary = summaryOf(snapshot);
    const values = [
      [SERVER_FEATURES.CONTAINERS_RUNNING, summary.containersRunning],
      [SERVER_FEATURES.CONTAINERS_DOWN, summary.containersDown],
      [SERVER_FEATURES.QUEUE, summary.queue],
      [SERVER_FEATURES.QUARANTINE, summary.quarantine],
      [SERVER_FEATURES.BANNED_IPS, summary.bans],
      [SERVER_FEATURES.STORAGE_USED, summary.storageUsedGb],
      [SERVER_FEATURES.STORAGE_PERCENT, summary.storagePercent],
      [SERVER_FEATURES.DOMAINS, summary.domains],
      [SERVER_FEATURES.MAILBOXES, summary.mailboxes],
    ];
    const states = values
      .filter(([, value]) => typeof value === 'number' && Number.isFinite(value))
      .map(([key, state]) => ({ device_feature_external_id: ids.feature(key), state }));
    if (snapshot?.version) {
      states.push({
        device_feature_external_id: ids.feature(SERVER_FEATURES.VERSION),
        text: snapshot.version,
      });
    }
    return states;
  },
};
