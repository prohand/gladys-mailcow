// -----------------------------------------------------------------------------
// A mailcow API in memory, for the tests: no network, no server.
//
// `createFakeMailcow()` returns the answers of a small but realistic server
// (shaped like the examples of the official openapi.yaml), editable per test,
// and a `request` function to hand to `new MailcowClient({ request })`: it
// answers like node:https would, records every call, and can be told to fail
// the way a network, a certificate or a key fails.
// -----------------------------------------------------------------------------

export function sampleAnswers() {
  return {
    'get/status/version': { version: '2025-03' },
    'get/status/containers': {
      'postfix-mailcow': {
        type: 'info',
        container: 'postfix-mailcow',
        state: 'running',
        image: 'mailcow/postfix:1.80',
        started_at: '2025-03-01T10:00:00Z',
      },
      'dovecot-mailcow': {
        type: 'info',
        container: 'dovecot-mailcow',
        state: 'running',
        image: 'mailcow/dovecot:2.30',
        started_at: '2025-03-01T10:00:00Z',
      },
      'rspamd-mailcow': {
        type: 'info',
        container: 'rspamd-mailcow',
        state: 'running',
        image: 'mailcow/rspamd:2.0',
        started_at: '2025-03-01T10:00:00Z',
      },
      'clamd-mailcow': {
        type: 'info',
        container: 'clamd-mailcow',
        state: 'running',
        image: 'mailcow/clamd:1.66',
        started_at: '2025-03-01T10:00:00Z',
      },
    },
    'get/status/vmail': {
      type: 'info',
      disk: '/dev/sda1',
      used: '11G',
      total: '41G',
      used_percent: '28%',
    },
    'get/mailq/all': [
      {
        queue_name: 'deferred',
        queue_id: 'B98C6260CA1',
        arrival_time: 1740000000,
        message_size: 1848,
        sender: 'a@example.com',
        recipients: ['b@elsewhere.tld'],
      },
    ],
    'get/quarantine/all': [
      {
        id: 33,
        qid: '8224615004C1',
        sender: 'bounces@spam.tld',
        rcpt: 'admin@example.com',
        subject: 'You won',
        score: 15.48,
        virus_flag: 0,
        created: 1740000000,
      },
      {
        id: 31,
        qid: '7224615004C1',
        sender: 'x@virus.tld',
        rcpt: 'john@example.com',
        subject: 'Invoice',
        score: 9.1,
        virus_flag: 1,
        created: 1739990000,
      },
    ],
    'get/fail2ban': {
      ban_time: 1800,
      active_bans: [{ ip: '203.0.113.7', network: '203.0.113.7/32', banned_until: '30m' }],
      perm_bans: [],
    },
    'get/domain/all': [
      {
        domain_name: 'example.com',
        active: '1',
        mboxes_in_domain: 2,
        aliases_in_domain: 3,
        msgs_total: '1500',
        bytes_total: String(3 * 1024 ** 3),
      },
    ],
    'get/mailbox/all': [
      {
        username: 'admin@example.com',
        domain: 'example.com',
        name: 'Admin',
        active: '1',
        quota: 2 * 1024 ** 3,
        quota_used: 1024 ** 3,
        percent_in_use: 50,
        messages: 1000,
      },
      {
        username: 'john@example.com',
        domain: 'example.com',
        name: 'John',
        active: 1,
        quota: 1024 ** 3,
        quota_used: 0.92 * 1024 ** 3,
        percent_in_use: 92,
        messages: 500,
      },
    ],
  };
}

/**
 * @param {object} [options]
 * @param {string} [options.apiKey] the key the fake accepts
 */
export function createFakeMailcow({ apiKey = 'secret-key' } = {}) {
  const fake = {
    answers: sampleAnswers(),
    calls: [],
    // URL prefix → failure: 'network' | 'timeout' | 'tls'
    down: new Map(),
    // path → { status, body } answered instead
    overrides: new Map(),
    apiKey,

    async request({ url, method, headers, body, rejectUnauthorized }) {
      const target = new URL(url);
      const path = target.pathname.replace(/^\/api\/v1\//, '');
      fake.calls.push({
        origin: target.origin,
        path,
        method,
        headers,
        body: body === undefined ? undefined : JSON.parse(body),
        rejectUnauthorized,
      });
      for (const [prefix, failure] of fake.down) {
        if (url.startsWith(prefix)) {
          const codes = {
            network: 'ECONNREFUSED',
            timeout: 'ETIMEDOUT',
            tls: 'DEPTH_ZERO_SELF_SIGNED_CERT',
          };
          const error = new Error(`fake ${failure}`);
          error.code = codes[failure];
          throw error;
        }
      }
      if (headers['X-API-Key'] !== fake.apiKey) {
        return {
          status: 401,
          body: JSON.stringify({ type: 'error', msg: 'authentication failed' }),
        };
      }
      if (fake.overrides.has(path)) {
        const { status, body: answer } = fake.overrides.get(path);
        return { status, body: typeof answer === 'string' ? answer : JSON.stringify(answer) };
      }
      if (method === 'POST') {
        return {
          status: 200,
          body: JSON.stringify([{ type: 'success', msg: ['done', path] }]),
        };
      }
      if (!(path in fake.answers)) {
        return { status: 404, body: JSON.stringify({ type: 'error', msg: 'route not found' }) };
      }
      return { status: 200, body: JSON.stringify(fake.answers[path]) };
    },

    /** The calls made to one path. */
    callsTo(path) {
      return fake.calls.filter((call) => call.path === path);
    },
  };
  fake.request = fake.request.bind(fake);
  return fake;
}

/** A normalized configuration pointing at the fake. */
export const LOCAL_URL = 'https://192.168.1.20';
export const PUBLIC_URL = 'https://mail.example.com';
