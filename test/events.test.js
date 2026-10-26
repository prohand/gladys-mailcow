import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MailcowClient } from '../src/mailcow/client.js';
import {
  diffSnapshots,
  MAX_EVENTS_PER_KIND,
  reachabilityEvent,
  SCENE_TRIGGERS,
} from '../src/mailcow/events.js';
import { readSnapshot } from '../src/mailcow/snapshot.js';
import { normalizeConfig } from '../src/config.js';
import { createFakeMailcow, LOCAL_URL } from './helpers/fakeMailcow.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const config = normalizeConfig({ local_url: LOCAL_URL, api_key: 'secret-key' });

async function twoReads(change) {
  const fake = createFakeMailcow();
  const client = new MailcowClient({ request: fake.request });
  client.configure(config);
  const before = await readSnapshot(client);
  change(fake.answers);
  const after = await readSnapshot(client);
  return diffSnapshots(before, after, config);
}

test('the first read fires nothing, nor a read where nothing changed', async () => {
  assert.deepEqual(await twoReads(() => {}), []);
  const fake = createFakeMailcow();
  const client = new MailcowClient({ request: fake.request });
  client.configure(config);
  assert.deepEqual(diffSnapshots(null, await readSnapshot(client), config), []);
});

test('a container that stops, and starts again', async () => {
  const down = await twoReads((answers) => {
    answers['get/status/containers']['clamd-mailcow'].state = 'exited';
  });
  assert.deepEqual(down, [
    { key: SCENE_TRIGGERS.CONTAINER_DOWN, data: { container: 'clamd', state: 'exited' } },
  ]);

  const fake = createFakeMailcow();
  const client = new MailcowClient({ request: fake.request });
  client.configure(config);
  fake.answers['get/status/containers']['sogo-mailcow'] = {
    container: 'sogo-mailcow',
    state: 'exited',
  };
  const before = await readSnapshot(client);
  fake.answers['get/status/containers']['sogo-mailcow'].state = 'running';
  delete fake.answers['get/status/containers']['clamd-mailcow'];
  const after = await readSnapshot(client);
  assert.deepEqual(diffSnapshots(before, after, config), [
    { key: SCENE_TRIGGERS.CONTAINER_UP, data: { container: 'sogo' } },
    { key: SCENE_TRIGGERS.CONTAINER_DOWN, data: { container: 'clamd', state: 'missing' } },
  ]);
});

test('the thresholds fire once, when crossed upwards', async () => {
  const events = await twoReads((answers) => {
    answers['get/mailq/all'] = Array.from({ length: 25 }, (_, i) => ({ queue_id: `q${i}` }));
    answers['get/status/vmail'].used_percent = '90%';
    answers['get/mailbox/all'][0].percent_in_use = 95;
  });
  assert.deepEqual(events, [
    { key: SCENE_TRIGGERS.QUEUE_HIGH, data: { queue_size: 25, threshold: 20 } },
    { key: SCENE_TRIGGERS.STORAGE_HIGH, data: { used_percent: 90, threshold: 85 } },
    {
      key: SCENE_TRIGGERS.QUOTA_HIGH,
      data: { mailbox: 'admin@example.com', domain: 'example.com', percent: 95, threshold: 90 },
    },
  ]);
  // john@ was already over 90 %: no event for him.
});

test('new quarantined mails and new bans', async () => {
  const events = await twoReads((answers) => {
    answers['get/quarantine/all'].push({
      id: 40,
      sender: 'new@spam.tld',
      rcpt: 'john@example.com',
      subject: 'Hello',
      score: 12,
      virus_flag: 0,
    });
    answers['get/fail2ban'].active_bans.push({ network: '198.51.100.0/24' });
  });
  assert.deepEqual(events, [
    {
      key: SCENE_TRIGGERS.QUARANTINE_NEW,
      data: {
        sender: 'new@spam.tld',
        recipient: 'john@example.com',
        subject: 'Hello',
        score: 12,
        virus: false,
      },
    },
    { key: SCENE_TRIGGERS.IP_BANNED, data: { ip: '198.51.100.0/24' } },
  ]);
});

test('a burst is capped', async () => {
  const events = await twoReads((answers) => {
    for (let i = 0; i < 30; i += 1) {
      answers['get/fail2ban'].active_bans.push({ ip: `198.51.100.${i}` });
    }
  });
  assert.equal(events.length, MAX_EVENTS_PER_KIND);
});

test('reachability: only the changes, never the first read', () => {
  assert.equal(reachabilityEvent(null, false), null);
  assert.equal(reachabilityEvent(null, true), null);
  assert.equal(reachabilityEvent(true, true), null);
  assert.deepEqual(reachabilityEvent(true, false, { error: { code: 'timeout', message: 'm' } }), {
    key: SCENE_TRIGGERS.CONNECTION_LOST,
    data: { reason: 'timeout', message: 'm' },
  });
  assert.deepEqual(reachabilityEvent(false, true, { transport: 'cloud' }), {
    key: SCENE_TRIGGERS.CONNECTION_RESTORED,
    data: { transport: 'cloud' },
  });
});

test('every trigger the code fires is declared, with the keys of its data', async () => {
  const declared = new Map(manifest.scene_triggers.map((trigger) => [trigger.key, trigger]));
  assert.deepEqual([...declared.keys()].sort(), Object.values(SCENE_TRIGGERS).sort());
  const samples = [
    ...(await twoReads((answers) => {
      answers['get/status/containers']['clamd-mailcow'].state = 'exited';
      answers['get/mailq/all'] = Array.from({ length: 25 }, (_, i) => ({ queue_id: `q${i}` }));
      answers['get/status/vmail'].used_percent = '90%';
      answers['get/mailbox/all'][0].percent_in_use = 95;
      answers['get/quarantine/all'].push({ id: 40, subject: 's', score: 1 });
      answers['get/fail2ban'].active_bans.push({ ip: '198.51.100.1' });
    })),
    ...diffSnapshots(
      { containers: [{ name: 'sogo', state: 'exited', running: false }] },
      { containers: [{ name: 'sogo', state: 'running', running: true }] },
      config,
    ),
    reachabilityEvent(true, false, { error: { code: 'timeout', message: 'm' } }),
    reachabilityEvent(false, true, { transport: 'local' }),
  ];
  const types = { string: 'string', number: 'number', boolean: 'boolean' };
  for (const { key, data } of samples) {
    const trigger = declared.get(key);
    assert.ok(trigger, `${key} is not declared`);
    const fields = new Map((trigger.fields ?? []).map((field) => [field.key, field]));
    const variables = new Map(
      (trigger.variables ?? []).map((variable) => [variable.key, variable]),
    );
    for (const [dataKey, value] of Object.entries(data)) {
      assert.ok(
        fields.has(dataKey) || variables.has(dataKey),
        `${key}: data.${dataKey} is not declared, the core would drop it`,
      );
      if (variables.has(dataKey)) {
        assert.equal(typeof value, types[variables.get(dataKey).type], `${key}: data.${dataKey}`);
      }
    }
    // A filter compares with the event value of the same key: it must be sent.
    for (const fieldKey of fields.keys()) {
      assert.ok(fieldKey in data, `${key}: the filter ${fieldKey} has no value to compare to`);
    }
  }
  // Every trigger is exercised above.
  assert.deepEqual(
    [...new Set(samples.map((sample) => sample.key))].sort(),
    [...declared.keys()].sort(),
  );
});
