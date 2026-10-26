// -----------------------------------------------------------------------------
// Integration configuration.
//
// The configuration is filled in by the user in Gladys, from the `config_schema`
// declared in `gladys-assistant-integration.json`. The SDK fetches it for you
// (`gladys.getConfig()`) and notifies you of every change through
// `gladys.onConfigUpdated()`.
//
// This module only provides defaults and normalizes the received object, so the
// rest of the code never has to deal with `undefined`, strings typed in a
// number field, or a URL pasted with a trailing slash.
// -----------------------------------------------------------------------------

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest (test/manifest.test.js checks it).
export const DEFAULT_CONFIG = {
  // The two ways to reach the same mailcow server. Either one, or both: the
  // LAN address is the "local" transport, the public one the "cloud" one.
  local_url: '',
  public_url: '',
  api_key: '',
  // A mailcow on the LAN is often reached by its IP, which its certificate
  // does not name: the user can turn the check off for that case.
  verify_tls: true,
  // Seconds between two reads of the server.
  poll_frequency: 300,
  domain_devices: true,
  mailbox_devices: false,
  // Off by default: a read-only API key is enough to watch the server, and
  // nothing in Gladys can then flush a queue or disable a mailbox by mistake.
  allow_changes: false,
  queue_threshold: 20,
  storage_threshold: 85,
  quota_threshold: 90,
  debug_logs: false,
  // Reserved key (NOT in config_schema): because the manifest declares both
  // 'local' and 'cloud' in its `transports` field, Gladys shows a standard
  // "Prefer the local connection" toggle and sends the user's choice here.
  // Read-only for the integration; defaults to true.
  GLADYS_PREFER_LOCAL: true,
};

// The slowest and fastest pace the refresh loop accepts, in seconds.
export const POLL_BOUNDS = { min: 60, max: 3600 };

/**
 * A base URL the client can call: `https://` added when the user typed a bare
 * host name, no trailing slash, no `/api/v1` (the client adds it), and `''`
 * for anything that is not an http(s) URL.
 *
 * @param {unknown} value what the user typed
 * @returns {string}
 */
export function normalizeUrl(value) {
  let text = typeof value === 'string' ? value.trim() : '';
  if (!text) {
    return '';
  }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    text = `https://${text}`;
  }
  let url;
  try {
    url = new URL(text);
  } catch {
    return '';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return '';
  }
  // Credentials in the URL would end up in the logs: the API key is the only
  // secret this integration carries.
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  const path = url.pathname.replace(/\/+$/, '').replace(/\/api\/v1$/, '');
  return `${url.origin}${path}`;
}

function toNumber(value, fallback, { min, max } = {}) {
  const number = Number(value);
  if (value === '' || value === null || value === undefined || !Number.isFinite(number)) {
    return fallback;
  }
  let bounded = number;
  if (min !== undefined) bounded = Math.max(min, bounded);
  if (max !== undefined) bounded = Math.min(max, bounded);
  return bounded;
}

function toBoolean(value, fallback) {
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return fallback;
}

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw ?? {};
  return {
    ...DEFAULT_CONFIG,
    ...source,
    local_url: normalizeUrl(source.local_url),
    public_url: normalizeUrl(source.public_url),
    api_key: typeof source.api_key === 'string' ? source.api_key.trim() : '',
    verify_tls: toBoolean(source.verify_tls, DEFAULT_CONFIG.verify_tls),
    poll_frequency: toNumber(source.poll_frequency, DEFAULT_CONFIG.poll_frequency, POLL_BOUNDS),
    domain_devices: toBoolean(source.domain_devices, DEFAULT_CONFIG.domain_devices),
    mailbox_devices: toBoolean(source.mailbox_devices, DEFAULT_CONFIG.mailbox_devices),
    allow_changes: toBoolean(source.allow_changes, DEFAULT_CONFIG.allow_changes),
    queue_threshold: toNumber(source.queue_threshold, DEFAULT_CONFIG.queue_threshold, {
      min: 1,
      max: 100000,
    }),
    storage_threshold: toNumber(source.storage_threshold, DEFAULT_CONFIG.storage_threshold, {
      min: 1,
      max: 100,
    }),
    quota_threshold: toNumber(source.quota_threshold, DEFAULT_CONFIG.quota_threshold, {
      min: 1,
      max: 100,
    }),
    debug_logs: toBoolean(source.debug_logs, DEFAULT_CONFIG.debug_logs),
    // The preference is a boolean; anything but an explicit false means true.
    GLADYS_PREFER_LOCAL: source.GLADYS_PREFER_LOCAL !== false,
  };
}

/** Whether the configuration names at least one server address and a key. */
export function isConfigured(config) {
  return Boolean((config.local_url || config.public_url) && config.api_key);
}
