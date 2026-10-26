import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { MailcowClient } from '../src/mailcow/client.js';
import { MailcowMonitor } from '../src/mailcow/monitor.js';
import { normalizeConfig } from '../src/config.js';
import { server } from '../src/devices/index.js';
import { WIDGET_KEYS } from '../src/capabilities/widgets.js';
import { createFakeMailcow, LOCAL_URL, PUBLIC_URL } from './helpers/fakeMailcow.js';

function setup(raw = {}) {
  const fake = createFakeMailcow();
  const gladys = createFakeGladys();
  const client = new MailcowClient({ request: fake.request });
  const monitor = new MailcowMonitor({ gladys, client, widgets: Object.values(WIDGET_KEYS) });
  monitor.configure(
    normalizeConfig({
      local_url: LOCAL_URL,
      public_url: PUBLIC_URL,
      api_key: 'secret-key',
      ...raw,
    }),
  );
  return { fake, gladys, client, monitor };
}

test('a read publishes the devices, the states, the badges and the status', async () => {
  const { gladys, monitor } = setup();
  const result = await monitor.refresh();
  assert.equal(result.ok, true);
  assert.equal(gladys.fake.discoveredDevices.length, 2, 'the server and its domain');
  assert.equal(gladys.fake.lastState(server.ids(gladys).feature('quarantine')), 2);
  assert.deepEqual(
    gladys.fake.transports.map((entry) => entry.transport),
    ['local', 'local'],
  );
  assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
  assert.deepEqual(gladys.fake.widgetRefreshes, Object.values(WIDGET_KEYS));
  assert.deepEqual(gladys.fake.sceneEvents, [], 'the first read is the baseline');
});

test('the next read only sends what changed', async () => {
  const { fake, gladys, monitor } = setup();
  await monitor.refresh();
  const requests = gladys.fake.requests.length;
  await monitor.refresh();
  // No new device list, no new states, no new badges, no new status.
  assert.equal(gladys.fake.requests.length, requests);

  fake.answers['get/mailq/all'] = [];
  await monitor.refresh();
  assert.equal(gladys.fake.lastState(server.ids(gladys).feature('queue')), 0);
  assert.deepEqual(gladys.fake.bodies('POST', '/state').at(-1).states.length, 1);
});

test('what changed between two reads fires the scene triggers', async () => {
  const { fake, gladys, monitor } = setup();
  await monitor.refresh();
  fake.answers['get/status/containers']['postfix-mailcow'].state = 'exited';
  await monitor.refresh();
  assert.deepEqual(gladys.fake.sceneEvents, [
    { key: 'container_down', data: { container: 'postfix', state: 'exited' } },
  ]);
});

test('a server that stops answering: status, badges and the connection_lost trigger', async () => {
  const { fake, gladys, monitor } = setup();
  await monitor.refresh();
  fake.down.set(LOCAL_URL, 'network');
  fake.down.set(PUBLIC_URL, 'network');
  const result = await monitor.refresh();
  assert.equal(result.ok, false);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /does not answer/);
  assert.ok(gladys.fake.transports.slice(-2).every((entry) => entry.transport === 'unreachable'));
  assert.deepEqual(
    gladys.fake.sceneEvents.map((event) => event.key),
    ['connection_lost'],
  );

  fake.down.clear();
  await monitor.refresh();
  assert.deepEqual(
    gladys.fake.sceneEvents.map((event) => event.key),
    ['connection_lost', 'connection_restored'],
  );
  assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
});

test('a fallback to the public address is a degraded badge', async () => {
  const { fake, gladys, monitor } = setup();
  fake.down.set(LOCAL_URL, 'timeout');
  await monitor.refresh();
  const [entry] = gladys.fake.transports;
  assert.equal(entry.transport, 'cloud');
  assert.equal(entry.degraded, true);
});

test('without any configuration, the server device is still published', async () => {
  const fake = createFakeMailcow();
  const gladys = createFakeGladys();
  const monitor = new MailcowMonitor({
    gladys,
    client: new MailcowClient({ request: fake.request }),
  });
  monitor.configure(normalizeConfig({}));
  const result = await monitor.refresh();
  assert.equal(result.error.code, 'not_configured');
  assert.equal(fake.calls.length, 0);
  assert.equal(gladys.fake.discoveredDevices.length, 1);
  assert.match(gladys.fake.connectionStatus.message.fr, /clé d'API/);
});

test('concurrent refreshes share one read', async () => {
  const { fake, monitor } = setup();
  await Promise.all([monitor.refresh(), monitor.refresh(), monitor.refresh()]);
  assert.equal(fake.callsTo('get/status/version').length, 1);
});

test('changes are refused unless allowed', async () => {
  const { fake, monitor } = setup();
  await monitor.refresh();
  await assert.rejects(monitor.flushQueue(), (err) => err.code === 'changes_disabled');
  await assert.rejects(
    monitor.setMailboxActive('john@example.com', false),
    (err) => err.code === 'changes_disabled',
  );
  assert.equal(
    fake.calls.filter((call) => call.method === 'POST').length,
    0,
    'nothing reached mailcow',
  );
});

test('flipping the "active" switch of a domain calls mailcow, then publishes the state', async () => {
  const { fake, gladys, monitor } = setup({ allow_changes: true });
  await monitor.refresh();
  const device = gladys.fake.discoveredDevices[1];
  const feature = device.features.find((f) => f.external_id.endsWith(':active'));
  assert.equal(feature.read_only, false);
  await monitor.setActive(device.external_id, feature.external_id, 0);
  assert.deepEqual(fake.callsTo('edit/domain')[0].body, {
    items: ['example.com'],
    attr: { active: '0' },
  });
  assert.equal(gladys.fake.lastState(feature.external_id), 0);
});

test('a mailbox turned off by address, and the queue flushed', async () => {
  const { fake, monitor } = setup({ allow_changes: true });
  await monitor.refresh();
  assert.equal(await monitor.setMailboxActive(' John@Example.com ', false), true);
  assert.deepEqual(fake.callsTo('edit/mailbox')[0].body, {
    items: ['john@example.com'],
    attr: { active: '0' },
  });
  assert.equal(await monitor.flushQueue(), 1);
  assert.deepEqual(fake.callsTo('edit/mailq')[0].body, { action: 'flush' });
  await assert.rejects(monitor.setMailboxActive('not-an-address', true), /not a mailbox/);
});

test('a new configuration starts a new baseline', async () => {
  const { fake, gladys, monitor } = setup();
  await monitor.refresh();
  fake.answers['get/status/containers']['postfix-mailcow'].state = 'exited';
  monitor.configure(normalizeConfig({ local_url: LOCAL_URL, api_key: 'secret-key' }));
  await monitor.refresh();
  assert.deepEqual(gladys.fake.sceneEvents, []);
});

test('the loop reads at the configured interval, and stops', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { fake, monitor } = setup({ poll_frequency: 120 });
  monitor.start();
  await monitor.running;
  assert.equal(fake.callsTo('get/status/version').length, 1);
  t.mock.timers.tick(120_000);
  await monitor.running;
  assert.equal(fake.callsTo('get/status/version').length, 2);
  monitor.stop();
  t.mock.timers.tick(240_000);
  assert.equal(fake.callsTo('get/status/version').length, 2);
});

test('a configuration saved during a read is read at once, and the old read is dropped', async () => {
  const { fake, gladys, monitor } = setup();
  const first = monitor.refresh();
  monitor.configure(
    normalizeConfig({ public_url: PUBLIC_URL, api_key: 'secret-key', domain_devices: false }),
  );
  const second = monitor.refresh();
  assert.notEqual(first, second);
  assert.equal((await first).error.code, 'stale');
  assert.equal((await second).ok, true);
  assert.equal(fake.callsTo('get/status/version').length, 2);
  assert.equal(gladys.fake.discoveredDevices.length, 1, 'the new configuration applies');
  assert.deepEqual(
    gladys.fake.transports.map((entry) => entry.transport),
    ['cloud'],
  );
});
