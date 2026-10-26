import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { MailcowClient, MailcowError, httpRequest } from '../src/mailcow/client.js';
import { normalizeConfig } from '../src/config.js';
import { createFakeMailcow, LOCAL_URL, PUBLIC_URL } from './helpers/fakeMailcow.js';

function setup(raw = {}) {
  const fake = createFakeMailcow();
  const client = new MailcowClient({ request: fake.request });
  client.configure(
    normalizeConfig({
      local_url: LOCAL_URL,
      public_url: PUBLIC_URL,
      api_key: 'secret-key',
      ...raw,
    }),
  );
  return { fake, client };
}

test('the API is called under /api/v1 with the key in X-API-Key', async () => {
  const { fake, client } = setup();
  assert.deepEqual(await client.get('get/status/version'), { version: '2025-03' });
  const [call] = fake.calls;
  assert.equal(call.origin, LOCAL_URL);
  assert.equal(call.path, 'get/status/version');
  assert.equal(call.headers['X-API-Key'], 'secret-key');
  assert.equal(call.method, 'GET');
});

test('the LAN address is preferred, and its badge is local', async () => {
  const { client } = setup();
  await client.get('get/status/version');
  assert.deepEqual(client.transportStatus(), { transport: 'local' });
});

test('a LAN address that does not answer falls back to the public one, flagged degraded', async () => {
  const { fake, client } = setup();
  fake.down.set(LOCAL_URL, 'network');
  await client.get('get/status/version');
  const status = client.transportStatus();
  assert.equal(status.transport, 'cloud');
  assert.equal(status.degraded, true);
  for (const language of ['en', 'fr', 'de', 'es']) {
    assert.ok(status.message[language], language);
  }
  // Within the same round, the address that answered is asked first.
  fake.calls.length = 0;
  await client.get('get/status/vmail');
  assert.deepEqual(
    fake.calls.map((call) => call.origin),
    [PUBLIC_URL],
  );
  // A new round tries the preferred address again.
  fake.down.clear();
  client.resetPreference();
  await client.get('get/status/vmail');
  assert.deepEqual(client.transportStatus(), { transport: 'local' });
});

test('with the cloud preferred, the public address goes first', async () => {
  const { fake, client } = setup({ GLADYS_PREFER_LOCAL: false });
  await client.get('get/status/version');
  assert.equal(fake.calls[0].origin, PUBLIC_URL);
  assert.deepEqual(client.transportStatus(), { transport: 'cloud' });
});

test('a single address is never degraded, and unreachable when it does not answer', async () => {
  const { fake, client } = setup({ public_url: '' });
  fake.down.set(LOCAL_URL, 'timeout');
  await assert.rejects(client.get('get/status/version'), (err) => err.code === 'network');
  assert.deepEqual(client.transportStatus(), { transport: 'unreachable' });
});

test('the certificate check: on for the public address, as configured for the LAN one', async () => {
  const { fake, client } = setup({ verify_tls: false });
  fake.down.set(LOCAL_URL, 'network');
  await client.get('get/status/version');
  assert.equal(fake.calls[0].rejectUnauthorized, false, 'LAN address, check off');
  assert.equal(fake.calls[1].rejectUnauthorized, true, 'public address, always checked');
});

test('a refused certificate is said as such', async () => {
  const { fake, client } = setup({ public_url: '' });
  fake.down.set(LOCAL_URL, 'tls');
  await assert.rejects(client.get('get/status/version'), (err) => {
    assert.equal(err.code, 'tls');
    assert.equal(err.detail, 'DEPTH_ZERO_SELF_SIGNED_CERT');
    return true;
  });
});

test('a refused key is not retried on the other address', async () => {
  const { fake, client } = setup({ api_key: 'wrong' });
  await assert.rejects(client.get('get/status/version'), (err) => err.code === 'auth');
  assert.equal(fake.calls.length, 1);
  // The server answered: the badge says which address, not unreachable.
  assert.deepEqual(client.transportStatus(), { transport: 'local' });
});

test('an IP outside the API allow-list is named', async () => {
  const { fake, client } = setup();
  fake.overrides.set('get/status/version', {
    status: 401,
    body: { type: 'error', msg: 'api access denied for ip 172.22.1.1' },
  });
  await assert.rejects(client.get('get/status/version'), (err) => {
    assert.equal(err.code, 'forbidden_ip');
    assert.equal(err.detail, '172.22.1.1');
    return true;
  });
});

test('a page that is not the API is said as such', async () => {
  const { fake, client } = setup();
  fake.overrides.set('get/status/version', { status: 200, body: '<html>SOGo</html>' });
  await assert.rejects(client.get('get/status/version'), (err) => err.code === 'invalid_response');
});

test('a change mailcow refuses with a 200 is an error', async () => {
  const { fake, client } = setup();
  fake.overrides.set('edit/mailbox', {
    status: 200,
    body: [{ type: 'danger', msg: ['access_denied'] }],
  });
  await assert.rejects(
    client.post('edit/mailbox', { items: ['a@b.c'], attr: { active: '0' } }),
    (err) => err instanceof MailcowError && err.code === 'api' && /access_denied/.test(err.message),
  );
});

test('a change is sent as JSON', async () => {
  const { fake, client } = setup();
  await client.post('edit/mailq', { action: 'flush' });
  const [call] = fake.callsTo('edit/mailq');
  assert.equal(call.method, 'POST');
  assert.deepEqual(call.body, { action: 'flush' });
  assert.equal(call.headers['Content-Type'], 'application/json');
});

test('nothing is sent without an address and a key', async () => {
  const client = new MailcowClient({
    request: () => assert.fail('no request expected'),
  });
  client.configure(normalizeConfig({}));
  await assert.rejects(client.get('get/status/version'), (err) => err.code === 'not_configured');
  assert.deepEqual(client.transportStatus(), { transport: 'unreachable' });
});

test('httpRequest talks plain HTTP to a loopback server', async (t) => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ path: req.url, key: req.headers['x-api-key'] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const { port } = server.address();
  const answer = await httpRequest({
    url: `http://127.0.0.1:${port}/api/v1/get/status/version`,
    method: 'GET',
    headers: { 'X-API-Key': 'k' },
    timeoutMs: 2000,
    rejectUnauthorized: true,
  });
  assert.equal(answer.status, 200);
  assert.deepEqual(JSON.parse(answer.body), { path: '/api/v1/get/status/version', key: 'k' });
});

test('httpRequest gives up after its timeout', async (t) => {
  const server = http.createServer(() => {
    // Never answers.
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const { port } = server.address();
  await assert.rejects(
    httpRequest({
      url: `http://127.0.0.1:${port}/api/v1/get/status/version`,
      method: 'GET',
      headers: {},
      timeoutMs: 100,
      rejectUnauthorized: true,
    }),
    (err) => err.code === 'timeout',
  );
});
