import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MailcowClient } from '../src/mailcow/client.js';
import {
  containerName,
  parsePercent,
  parseSize,
  readContainers,
  readMailboxes,
  readQuarantine,
  readSnapshot,
  summaryOf,
} from '../src/mailcow/snapshot.js';
import { normalizeConfig } from '../src/config.js';
import { createFakeMailcow, LOCAL_URL } from './helpers/fakeMailcow.js';

function setup() {
  const fake = createFakeMailcow();
  const client = new MailcowClient({ request: fake.request });
  client.configure(normalizeConfig({ local_url: LOCAL_URL, api_key: 'secret-key' }));
  return { fake, client };
}

test('container names, whatever the Compose version calls them', () => {
  assert.equal(containerName('postfix-mailcow', { container: 'postfix-mailcow' }), 'postfix');
  assert.equal(
    containerName('x', { container: '/mailcowdockerized-postfix-mailcow-1' }),
    'postfix',
  );
  assert.equal(containerName('x', { container: 'mailcowdockerized_php-fpm-mailcow_1' }), 'php-fpm');
  assert.equal(containerName('ipv6nat-mailcow', {}), 'ipv6nat');
});

test('df sizes in gigabytes, percentages as numbers', () => {
  assert.equal(parseSize('11G'), 11);
  assert.equal(parseSize('512M'), 0.5);
  assert.equal(parseSize('1.5T'), 1536);
  assert.equal(parseSize('2,5G'), 2.5);
  assert.equal(parseSize('nonsense'), null);
  assert.equal(parsePercent('28%'), 28);
  assert.equal(parsePercent(42), 42);
  assert.equal(parsePercent('- '), null);
});

test('a container not running is counted down, whatever its state', () => {
  const containers = readContainers({
    a: { container: 'postfix-mailcow', state: 'running' },
    b: { container: 'clamd-mailcow', state: 'exited' },
    c: { container: 'sogo-mailcow', state: 'restarting' },
  });
  assert.deepEqual(
    containers.map((c) => [c.name, c.running]),
    [
      ['clamd', false],
      ['postfix', true],
      ['sogo', false],
    ],
  );
});

test('the quarantine, newest first, and the highest id kept for the next read', () => {
  const quarantine = readQuarantine([
    { id: 2, subject: 'b', score: '7.123' },
    { id: 9, subject: 'c', virus_flag: '1', created: 1740000000 },
  ]);
  assert.equal(quarantine.total, 2);
  assert.equal(quarantine.maxId, 9);
  assert.equal(quarantine.items[0].virus, true);
  assert.equal(quarantine.items[0].createdAt, '2025-02-19T21:20:00.000Z');
  assert.equal(quarantine.items[1].score, 7.12);
  // A single entry (the openapi example shape).
  assert.equal(readQuarantine({ id: 4, subject: 'x' }).total, 1);
  assert.equal(readQuarantine([]).maxId, 0);
});

test('an unlimited mailbox reads 0 %', () => {
  const [mailbox] = readMailboxes([
    { username: 'A@Example.com', quota: 0, quota_used: 5, percent_in_use: '- ', active: '1' },
  ]);
  assert.equal(mailbox.username, 'a@example.com');
  assert.equal(mailbox.domain, 'example.com');
  assert.equal(mailbox.percent, 0);
  assert.equal(mailbox.active, true);
});

test('a whole read of the sample server', async () => {
  const { client } = setup();
  const snapshot = await readSnapshot(client, { now: () => new Date('2026-01-01T00:00:00Z') });
  assert.equal(snapshot.at, '2026-01-01T00:00:00.000Z');
  assert.equal(snapshot.version, '2025-03');
  assert.deepEqual(snapshot.errors, {});
  assert.deepEqual(summaryOf(snapshot), {
    containersRunning: 4,
    containersDown: 0,
    containersTotal: 4,
    stoppedContainers: [],
    queue: 1,
    quarantine: 2,
    bans: 1,
    storagePercent: 28,
    storageUsedGb: 11,
    storageTotalGb: 41,
    domains: 1,
    mailboxes: 2,
  });
  assert.deepEqual(snapshot.queue, { total: 1, deferred: 1, hold: 0, active: 0 });
  assert.deepEqual(snapshot.domains[0], {
    name: 'example.com',
    active: true,
    mailboxes: 2,
    aliases: 3,
    messages: 1500,
    usedGb: 3,
  });
});

test('a section that fails is left out, the rest is read', async () => {
  const { fake, client } = setup();
  delete fake.answers['get/fail2ban'];
  const snapshot = await readSnapshot(client);
  assert.equal(snapshot.bans, null);
  assert.match(snapshot.errors.bans, /route not found/);
  assert.equal(snapshot.queue.total, 1);
  assert.equal(summaryOf(snapshot).bans, null);
});

test('a server that refuses the key fails the whole read', async () => {
  const { fake, client } = setup();
  fake.apiKey = 'another';
  await assert.rejects(readSnapshot(client), (err) => err.code === 'auth');
  assert.equal(fake.calls.length, 1, 'nothing else is asked');
});
