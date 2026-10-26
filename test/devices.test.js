import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { MailcowClient } from '../src/mailcow/client.js';
import { readSnapshot } from '../src/mailcow/snapshot.js';
import { normalizeConfig } from '../src/config.js';
import {
  buildDiscoveredDevices,
  buildStates,
  findDevice,
  isActiveFeature,
  server,
} from '../src/devices/index.js';
import { MAX_MAILBOX_DEVICES } from '../src/devices/mailbox.js';
import { createFakeMailcow, LOCAL_URL } from './helpers/fakeMailcow.js';

async function sampleSnapshot() {
  const fake = createFakeMailcow();
  const client = new MailcowClient({ request: fake.request });
  client.configure(normalizeConfig({ local_url: LOCAL_URL, api_key: 'secret-key' }));
  return readSnapshot(client);
}

test('Gladys accepts the devices and their states', async () => {
  const gladys = createFakeGladys();
  const snapshot = await sampleSnapshot();
  const config = normalizeConfig({ mailbox_devices: true });
  // The fake Gladys refuses what the host API refuses, with the same 400.
  await gladys.publishDiscoveredDevices(buildDiscoveredDevices(gladys, snapshot, config));
  await gladys.publishStates(buildStates(gladys, snapshot, config));
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((device) => device.name),
    ['mailcow server', 'mailcow example.com', 'admin@example.com', 'john@example.com'],
  );
  const ids = server.ids(gladys);
  assert.equal(gladys.fake.lastState(ids.feature('queue')), 1);
  assert.equal(gladys.fake.lastState(ids.feature('storage-percent')), 28);
  assert.equal(gladys.fake.lastState(ids.feature('version')), '2025-03');
});

test('every feature declares min and max (NOT NULL in Gladys)', async () => {
  const gladys = createFakeGladys();
  const devices = buildDiscoveredDevices(
    gladys,
    await sampleSnapshot(),
    normalizeConfig({ mailbox_devices: true }),
  );
  for (const feature of devices.flatMap((device) => device.features)) {
    assert.equal(typeof feature.min, 'number', feature.external_id);
    assert.equal(typeof feature.max, 'number', feature.external_id);
  }
});

test('no domain nor mailbox device unless asked, and the server alone without a read', async () => {
  const gladys = createFakeGladys();
  const snapshot = await sampleSnapshot();
  const config = normalizeConfig({ domain_devices: false });
  assert.equal(buildDiscoveredDevices(gladys, snapshot, config).length, 1);
  assert.equal(buildDiscoveredDevices(gladys, null, normalizeConfig()).length, 1);
  assert.deepEqual(buildStates(gladys, null, normalizeConfig()), []);
});

test('the "active" switches are controllable only when changes are allowed', async () => {
  const gladys = createFakeGladys();
  const snapshot = await sampleSnapshot();
  const switches = (config) =>
    buildDiscoveredDevices(gladys, snapshot, config)
      .flatMap((device) => device.features)
      .filter((feature) => isActiveFeature(feature.external_id));
  assert.ok(switches(normalizeConfig()).every((feature) => feature.read_only));
  assert.ok(
    switches(normalizeConfig({ allow_changes: true, mailbox_devices: true })).every(
      (feature) => !feature.read_only,
    ),
  );
});

test('a device is found back from its external id', async () => {
  const gladys = createFakeGladys();
  const snapshot = await sampleSnapshot();
  const config = normalizeConfig({ mailbox_devices: true });
  const [serverDevice, domainDevice, mailboxDevice] = buildDiscoveredDevices(
    gladys,
    snapshot,
    config,
  );
  assert.equal(findDevice(gladys, snapshot, config, serverDevice.external_id).entry, null);
  assert.equal(
    findDevice(gladys, snapshot, config, domainDevice.external_id).entry.name,
    'example.com',
  );
  assert.equal(
    findDevice(gladys, snapshot, config, mailboxDevice.external_id).entry.username,
    'admin@example.com',
  );
  assert.equal(findDevice(gladys, snapshot, config, 'ext:test-integration:nope'), null);
});

test('external ids are built from the ids mailcow keys on', async () => {
  const gladys = createFakeGladys();
  const devices = buildDiscoveredDevices(
    gladys,
    await sampleSnapshot(),
    normalizeConfig({ mailbox_devices: true }),
  );
  assert.deepEqual(
    devices.map((device) => device.external_id),
    [
      'ext:test-integration:server:mailcow',
      'ext:test-integration:domain:example.com',
      'ext:test-integration:mailbox:admin@example.com',
      'ext:test-integration:mailbox:john@example.com',
    ],
  );
});

test('a large server does not flood Gladys with mailbox devices', async () => {
  const gladys = createFakeGladys();
  const snapshot = await sampleSnapshot();
  snapshot.mailboxes = Array.from({ length: 500 }, (_, i) => ({
    ...snapshot.mailboxes[0],
    username: `user${i}@example.com`,
  }));
  const devices = buildDiscoveredDevices(
    gladys,
    snapshot,
    normalizeConfig({ mailbox_devices: true, domain_devices: false }),
  );
  assert.equal(devices.length, 1 + MAX_MAILBOX_DEVICES);
});
