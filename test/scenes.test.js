import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { MailcowClient } from '../src/mailcow/client.js';
import { MailcowMonitor } from '../src/mailcow/monitor.js';
import { normalizeConfig } from '../src/config.js';
import { SCENE_ACTIONS } from '../src/capabilities/scenes.js';
import { createFakeMailcow, LOCAL_URL } from './helpers/fakeMailcow.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

function setup(raw = {}) {
  const fake = createFakeMailcow();
  const gladys = createFakeGladys();
  const monitor = new MailcowMonitor({
    gladys,
    client: new MailcowClient({ request: fake.request }),
  });
  monitor.configure(normalizeConfig({ local_url: LOCAL_URL, api_key: 'secret-key', ...raw }));
  return { fake, monitor };
}

const declared = new Map(manifest.scene_actions.map((action) => [action.key, action]));

test('every scene action is declared, and the other way round', () => {
  assert.deepEqual([...declared.keys()].sort(), Object.keys(SCENE_ACTIONS).sort());
});

/** The outputs only carry declared keys, with their declared type (or null). */
function assertOutputs(key, outputs) {
  const types = new Map((declared.get(key).outputs ?? []).map((o) => [o.key, o.type]));
  for (const [name, value] of Object.entries(outputs ?? {})) {
    assert.ok(types.has(name), `${key}: output ${name} is not declared, the core drops it`);
    if (value !== null) {
      assert.equal(typeof value, types.get(name), `${key}.${name}`);
    }
  }
}

test('refresh hands the main counters to the next actions', async () => {
  const { monitor } = setup();
  const outputs = await SCENE_ACTIONS.refresh(monitor, {});
  assert.deepEqual(outputs, {
    reachable: true,
    queue_size: 1,
    quarantine: 2,
    containers_down: 0,
    storage_percent: 28,
  });
  assertOutputs('refresh', outputs);
});

test('refresh on an unreachable server says so instead of failing', async () => {
  const { fake, monitor } = setup();
  fake.down.set(LOCAL_URL, 'network');
  const outputs = await SCENE_ACTIONS.refresh(monitor, {});
  assert.equal(outputs.reachable, false);
  assert.equal(outputs.queue_size, null);
  assertOutputs('refresh', outputs);
});

test('flush_queue and set_mailbox_active act only when changes are allowed', async () => {
  const locked = setup();
  await assert.rejects(SCENE_ACTIONS.flush_queue(locked.monitor, {}), /turned off/);

  const { fake, monitor } = setup({ allow_changes: true });
  await monitor.refresh();
  const flushed = await SCENE_ACTIONS.flush_queue(monitor, {});
  assert.deepEqual(flushed, { queued_before: 1 });
  assertOutputs('flush_queue', flushed);

  const changed = await SCENE_ACTIONS.set_mailbox_active(monitor, {
    mailbox: 'admin@example.com',
    active: false,
  });
  assert.deepEqual(changed, { changed: true });
  assertOutputs('set_mailbox_active', changed);
  assert.deepEqual(fake.callsTo('edit/mailbox')[0].body.attr, { active: '0' });
  // The field defaults to true when the scene author leaves it.
  await SCENE_ACTIONS.set_mailbox_active(monitor, { mailbox: 'admin@example.com' });
  assert.deepEqual(fake.callsTo('edit/mailbox')[1].body.attr, { active: '1' });
});
