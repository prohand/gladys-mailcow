// -----------------------------------------------------------------------------
// HTTP client of the mailcow API (`/api/v1`, `X-API-Key` header).
//
// A mailcow server can be reached two ways, and the user may give both: its
// LAN address (the "local" transport) and its public one (the "cloud"
// transport — mailcow is self-hosted, but a VPS or a box reached over the
// internet is "cloud" as far as Gladys' badge is concerned). The manifest
// declares both transports, so Gladys shows its standard "Prefer the local
// connection" toggle: the preferred address is tried first, the other one is
// the fallback, and the badge says which one answered — degraded when it is
// not the preferred one, so a broken LAN route does not hide behind a working
// public one.
//
// Built on node:http / node:https rather than the global fetch: a mailcow on
// the LAN is usually reached by its IP, which its certificate does not name,
// and only the node modules let the user turn the check off for that address
// (`verify_tls`, LAN address only), without any extra dependency.
// -----------------------------------------------------------------------------

import http from 'node:http';
import https from 'node:https';
import { DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';

const API_PREFIX = '/api/v1/';
const DEFAULT_TIMEOUT_MS = 15_000;
// A mailbox list of a large server is a few MB; anything far beyond is not
// the mailcow API answering.
const MAX_BODY_BYTES = 32 * 1024 * 1024;

// Node's codes for a certificate the client refused.
const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'CERT_NOT_YET_VALID',
]);

/**
 * What went wrong, as a code the messages and the scene events can rely on.
 *
 * - `not_configured`: no address or no API key;
 * - `network`, `timeout`, `tls`: the address did not answer (the fallback
 *   address is tried);
 * - `auth`: the key is refused;
 * - `forbidden_ip`: the key is fine, but Gladys' IP is not in the list of the
 *   addresses allowed to use the API;
 * - `read_only`: a change asked with a read-only key;
 * - `invalid_response`: something answered, but not the mailcow API (a reverse
 *   proxy page, a wrong path);
 * - `api`: the API answered with an error (an unknown mailbox...);
 * - `changes_disabled`: a change asked while the configuration forbids them.
 */
export class MailcowError extends Error {
  constructor(message, { code, status = null, detail = null } = {}) {
    super(message);
    this.name = 'MailcowError';
    this.code = code;
    this.status = status;
    this.detail = detail;
  }

  /** Whether the address itself did not answer, so the other one is worth a try. */
  get unreachable() {
    return ['network', 'timeout', 'tls'].includes(this.code);
  }
}

/**
 * One HTTP exchange, resolved with the status and the raw body. The default
 * `request` of the client; tests pass their own.
 */
export function httpRequest({ url, method, headers, body, timeoutMs, rejectUnauthorized }) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === 'https:' ? https : http;
    const req = transport.request(
      target,
      {
        method,
        headers,
        timeout: timeoutMs,
        ...(target.protocol === 'https:' ? { rejectUnauthorized } : {}),
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) {
            req.destroy(new MailcowError('Answer too large', { code: 'invalid_response' }));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () =>
          resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }),
        );
        res.on('error', reject);
      },
    );
    req.on('timeout', () => {
      req.destroy(new MailcowError(`No answer after ${timeoutMs / 1000} s`, { code: 'timeout' }));
    });
    req.on('error', reject);
    if (body !== undefined) {
      req.write(body);
    }
    req.end();
  });
}

/** Turn a low-level failure into a MailcowError. */
function asMailcowError(err) {
  if (err instanceof MailcowError) {
    return err;
  }
  if (TLS_CODES.has(err?.code) || /certificate/i.test(err?.message ?? '')) {
    return new MailcowError(`Certificate refused (${err.code ?? err.message})`, {
      code: 'tls',
      detail: err.code ?? null,
    });
  }
  return new MailcowError(`${err?.code ?? 'Network error'}: ${err?.message ?? err}`, {
    code: 'network',
    detail: err?.code ?? null,
  });
}

/** The error a non-2xx answer stands for. */
function httpError(status, payload, method) {
  const msg = Array.isArray(payload?.msg) ? payload.msg.join(' ') : String(payload?.msg ?? '');
  const deniedIp = /api access denied for ip ([^\s"]+)/i.exec(msg);
  if (deniedIp) {
    return new MailcowError(`API access denied for IP ${deniedIp[1]}`, {
      code: 'forbidden_ip',
      status,
      detail: deniedIp[1],
    });
  }
  if (status === 403 && method !== 'GET') {
    return new MailcowError('This API key is read-only', { code: 'read_only', status });
  }
  if (status === 401 || status === 403) {
    return new MailcowError(`API key refused${msg ? ` (${msg})` : ''}`, { code: 'auth', status });
  }
  return new MailcowError(`HTTP ${status}${msg ? `: ${msg}` : ''}`, { code: 'api', status });
}

/**
 * The entries of an edit/delete answer that report a failure: mailcow answers
 * 200 with `{ type: 'danger' | 'error', msg }` entries.
 */
function failuresOf(payload) {
  const entries = Array.isArray(payload) ? payload : [payload];
  return entries.filter((entry) => entry && ['danger', 'error'].includes(entry.type));
}

export class MailcowClient {
  /**
   * @param {object} [options]
   * @param {Function} [options.request] the HTTP exchange (tests)
   * @param {number} [options.timeoutMs]
   */
  constructor({ request = httpRequest, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    this.request = request;
    this.timeoutMs = timeoutMs;
    this.channels = [];
    this.apiKey = '';
    // The channel that answered last, null before the first exchange or once
    // none answered.
    this.current = null;
    // The failure of the last exchange where no address answered.
    this.lastFailure = null;
    this.contacted = false;
  }

  /**
   * Apply a (normalized) configuration: the addresses in the order the user
   * prefers, the key, and the certificate check of the LAN address.
   */
  configure(config) {
    const local = config.local_url
      ? {
          transport: DEVICE_TRANSPORTS.LOCAL,
          url: config.local_url,
          verifyTls: config.verify_tls !== false,
        }
      : null;
    const cloud = config.public_url
      ? // A public address carries a real certificate (mailcow gets one from
        // Let's Encrypt): never skip its check, the API key travels with it.
        { transport: DEVICE_TRANSPORTS.CLOUD, url: config.public_url, verifyTls: true }
      : null;
    const ordered = config.GLADYS_PREFER_LOCAL === false ? [cloud, local] : [local, cloud];
    this.channels = ordered.filter(Boolean);
    this.apiKey = config.api_key ?? '';
    this.current = null;
    this.lastFailure = null;
    this.contacted = false;
  }

  get configured() {
    return this.channels.length > 0 && Boolean(this.apiKey);
  }

  /**
   * Start the next round from the preferred address again: a LAN route that
   * failed once is not given up for good.
   */
  resetPreference() {
    this.current = null;
  }

  /** The base URL of the address in use (or the preferred one), for links. */
  get baseUrl() {
    return (this.current ?? this.channels[0])?.url ?? null;
  }

  async get(path) {
    return this.send('GET', path);
  }

  /**
   * A change. The answer is checked for the `danger`/`error` entries mailcow
   * reports with a 200.
   */
  async post(path, body) {
    const payload = await this.send('POST', path, body);
    const failures = failuresOf(payload);
    if (failures.length > 0) {
      const msg = failures
        .map((entry) => (Array.isArray(entry.msg) ? entry.msg.join(' ') : entry.msg))
        .join('; ');
      throw new MailcowError(`mailcow refused the change: ${msg}`, { code: 'api', detail: msg });
    }
    return payload;
  }

  async send(method, path, body) {
    if (!this.configured) {
      throw new MailcowError('No mailcow address or API key configured', {
        code: 'not_configured',
      });
    }
    const order = this.current
      ? [this.current, ...this.channels.filter((channel) => channel !== this.current)]
      : this.channels;
    let failure = null;
    for (const channel of order) {
      try {
        const payload = await this.exchange(channel, method, path, body);
        this.current = channel;
        this.lastFailure = null;
        this.contacted = true;
        return payload;
      } catch (err) {
        const error = asMailcowError(err);
        if (!error.unreachable) {
          // The server answered: the address works, the request does not.
          this.current = channel;
          this.lastFailure = null;
          this.contacted = true;
          throw error;
        }
        failure = error;
      }
    }
    this.current = null;
    this.lastFailure = failure;
    this.contacted = true;
    throw failure;
  }

  async exchange(channel, method, path, body) {
    const headers = {
      'X-API-Key': this.apiKey,
      Accept: 'application/json',
      'User-Agent': 'gladys-mailcow',
    };
    let encoded;
    if (body !== undefined) {
      encoded = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(encoded);
    }
    const { status, body: text } = await this.request({
      url: `${channel.url}${API_PREFIX}${path.replace(/^\/+/, '')}`,
      method,
      headers,
      body: encoded,
      timeoutMs: this.timeoutMs,
      rejectUnauthorized: channel.verifyTls,
    });
    let payload;
    try {
      payload = text === '' ? null : JSON.parse(text);
    } catch {
      // A login page, a proxy error page: not the API.
      if (status === 401 || status === 403) {
        throw httpError(status, null, method);
      }
      throw new MailcowError(`HTTP ${status}, not a JSON answer`, {
        code: 'invalid_response',
        status,
      });
    }
    if (status < 200 || status >= 300) {
      throw httpError(status, payload, method);
    }
    // Some versions answer the auth failures with a 200.
    if (
      payload &&
      !Array.isArray(payload) &&
      payload.type === 'error' &&
      /authentication failed|api access denied/i.test(String(payload.msg))
    ) {
      throw httpError(401, payload, method);
    }
    return payload;
  }

  /**
   * The transport badge of every device: the channel that answered last,
   * degraded when it is not the preferred one, unreachable when none did.
   *
   * @returns {{ transport: string, degraded?: boolean, message?: object }}
   */
  transportStatus() {
    if (!this.configured) {
      return { transport: DEVICE_TRANSPORTS.UNREACHABLE };
    }
    if (this.lastFailure) {
      return { transport: DEVICE_TRANSPORTS.UNREACHABLE };
    }
    const preferred = this.channels[0];
    const used = this.current ?? preferred;
    if (used !== preferred && this.channels.length > 1) {
      return {
        transport: used.transport,
        degraded: true,
        message:
          used.transport === DEVICE_TRANSPORTS.CLOUD
            ? {
                en: 'The LAN address does not answer, using the public one.',
                fr: "L'adresse locale ne répond pas, l'adresse publique est utilisée.",
                de: 'Die lokale Adresse antwortet nicht, die öffentliche wird verwendet.',
                es: 'La dirección local no responde, se usa la pública.',
              }
            : {
                en: 'The public address does not answer, using the LAN one.',
                fr: "L'adresse publique ne répond pas, l'adresse locale est utilisée.",
                de: 'Die öffentliche Adresse antwortet nicht, die lokale wird verwendet.',
                es: 'La dirección pública no responde, se usa la local.',
              },
      };
    }
    return { transport: used.transport };
  }
}
