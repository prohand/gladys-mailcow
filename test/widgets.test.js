import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { MailcowClient } from '../src/mailcow/client.js';
import { MailcowMonitor } from '../src/mailcow/monitor.js';
import { normalizeConfig } from '../src/config.js';
import { buildDiscoveredDevices } from '../src/devices/index.js';
import {
  truncate,
  WIDGET_ACTIONS,
  WIDGET_KEYS,
  widgetAction,
  widgetContent,
} from '../src/capabilities/widgets.js';
import { LANGUAGES } from '../src/i18n.js';
import { createFakeMailcow, LOCAL_URL, PUBLIC_URL } from './helpers/fakeMailcow.js';

async function setup(raw = {}, { read = true } = {}) {
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
  if (read) {
    await monitor.refresh();
  }
  return { fake, gladys, monitor };
}

/** Every content a widget can show, rendered exactly as sent. */
function assertValid(content, where) {
  // [] = nothing the core would drop, truncate or trim to the content budget.
  assert.deepEqual(validateWidgetContent(content), [], where);
}

test('every widget renders exactly as sent, in every state', async () => {
  const states = {
    nominal: await setup(),
    'changes allowed': await setup({ allow_changes: true }),
    'not read yet': await setup({}, { read: false }),
  };
  const down = await setup();
  down.fake.down.set(LOCAL_URL, 'network');
  down.fake.down.set(PUBLIC_URL, 'network');
  await down.monitor.refresh();
  states.unreachable = down;
  const stopped = await setup();
  stopped.fake.answers['get/status/containers']['clamd-mailcow'].state = 'exited';
  stopped.fake.answers['get/quarantine/all'] = [];
  stopped.fake.answers['get/mailbox/all'] = [];
  await stopped.monitor.refresh();
  states['container stopped, nothing in quarantine'] = stopped;

  for (const [name, { monitor }] of Object.entries(states)) {
    for (const key of Object.values(WIDGET_KEYS)) {
      assertValid(widgetContent(monitor, key, { settings: {} }), `${key} (${name})`);
    }
  }
});

test('the status widget: live tiles bound to features the server publishes', async () => {
  const { gladys, monitor } = await setup();
  const content = widgetContent(monitor, WIDGET_KEYS.STATUS, { settings: {} });
  const features = new Set(
    buildDiscoveredDevices(gladys, monitor.snapshot, monitor.config).flatMap((device) =>
      device.features.map((feature) => feature.external_id),
    ),
  );
  const live = content.components.filter((component) => component.device_feature);
  assert.ok(live.length > 0);
  for (const tile of live) {
    assert.ok(features.has(tile.device_feature), tile.device_feature);
  }
  const gauge = content.components.find((component) => component.type === 'gauge');
  assert.equal(gauge.value, 28);
});

test('the flush button only shows when changes are allowed, and asks first', async () => {
  const buttonsOf = (monitor) =>
    widgetContent(monitor, WIDGET_KEYS.STATUS, { settings: {} })
      .components.filter((component) => component.type === 'button' && component.action)
      .map((component) => component.action);
  assert.deepEqual(
    buttonsOf((await setup()).monitor).map((action) => action.key),
    [WIDGET_ACTIONS.REFRESH],
  );
  const flush = buttonsOf((await setup({ allow_changes: true })).monitor).find(
    (action) => action.key === WIDGET_ACTIONS.FLUSH_QUEUE,
  );
  assert.equal(flush.confirm, true);
});

test('the quarantine widget lists the newest first, as many as asked', async () => {
  const { monitor } = await setup();
  const content = widgetContent(monitor, WIDGET_KEYS.QUARANTINE, { settings: { items: 1 } });
  const list = content.components.find((component) => component.type === 'card-list');
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].title, 'You won');
});

test('the mailboxes widget: the fullest first, filtered by domain', async () => {
  const { monitor } = await setup();
  const content = widgetContent(monitor, WIDGET_KEYS.MAILBOXES, { settings: {} });
  const [status] = content.components;
  assert.deepEqual(
    status.items.map((item) => [item.label, item.value, item.color]),
    [
      ['john@example.com', '92 %', 'danger'],
      ['admin@example.com', '50 %', 'success'],
    ],
  );
  const other = widgetContent(monitor, WIDGET_KEYS.MAILBOXES, {
    settings: { domain: 'other.tld' },
  });
  assert.equal(other.components[0].type, 'text');
});

test('every button action is handled and answers a short toast in every language', async () => {
  const { monitor } = await setup({ allow_changes: true });
  for (const actionKey of Object.values(WIDGET_ACTIONS)) {
    const toast = await widgetAction(monitor, actionKey);
    for (const language of LANGUAGES) {
      assert.ok(toast[language], `${actionKey}.${language}`);
      assert.ok(toast[language].length <= 200, `${actionKey}.${language} is too long`);
    }
  }
  await assert.rejects(widgetAction(monitor, 'nope'), /Unknown widget action/);
});

test('flushing from the widget without permission fails', async () => {
  const { monitor } = await setup();
  await assert.rejects(
    widgetAction(monitor, WIDGET_ACTIONS.FLUSH_QUEUE),
    (err) => err.code === 'changes_disabled',
  );
});

test('truncate keeps short texts and cuts long ones', () => {
  assert.equal(truncate('abc', 5), 'abc');
  assert.equal(truncate('abcdef', 5), 'abcd…');
  assert.equal(truncate(null, 5), '');
});
