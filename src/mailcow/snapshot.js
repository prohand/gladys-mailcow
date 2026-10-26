// -----------------------------------------------------------------------------
// One read of the whole server: the "snapshot".
//
// Every refresh reads the mailcow API once — version, containers, storage,
// queue, quarantine, fail2ban, domains, mailboxes — and turns the answers into
// one plain object. The devices publish their states from it, the widgets
// render it, and two snapshots in a row tell what changed (src/mailcow/
// events.js). One read for all, whatever the number of devices: the API is
// asked the same questions once per interval, not once per device.
//
// The version is read first and alone: it is what says whether the server
// answers and the key is accepted. The other sections are read together, and
// one that fails (an endpoint an older mailcow does not have, a timeout) is
// left `null` and named in `errors` instead of failing the whole read.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'snapshot' });

/**
 * The containers of a mailcow: dockerized install, by their short name. The
 * options of the container filter of the scene triggers; a container this
 * list does not know is still read and reported.
 */
export const KNOWN_CONTAINERS = [
  'acme',
  'clamd',
  'dockerapi',
  'dovecot',
  'memcached',
  'mysql',
  'netfilter',
  'nginx',
  'ofelia',
  'olefy',
  'php-fpm',
  'postfix',
  'redis',
  'rspamd',
  'sogo',
  'unbound',
  'watchdog',
];

// How many quarantined mails the snapshot keeps (newest first): the widget
// shows a few, the events only need the ones newer than the last read.
const QUARANTINE_KEPT = 20;

/**
 * The short name of a container: `postfix` for `postfix-mailcow`, for
 * `/mailcowdockerized-postfix-mailcow-1` (Compose v2) and the like.
 */
export function containerName(key, entry) {
  const raw = String(entry?.container ?? entry?.name ?? key ?? '')
    .replace(/^\/+/, '')
    .toLowerCase();
  const match =
    /(?:^|[-_])([a-z0-9-]+?)-mailcow(?:[-_]\d+)?$/.exec(raw) ?? /^([a-z0-9-]+)$/.exec(raw);
  const name = match ? match[1] : raw;
  // Compose v2 prefixes the project name: keep the known service it ends with.
  const known = KNOWN_CONTAINERS.find(
    (container) => name === container || name.endsWith(`-${container}`),
  );
  return known ?? name;
}

/**
 * A `df -h` size ("11G", "512M", "1.5T", "0") in gigabytes, rounded to two
 * decimals; null when it cannot be read.
 */
export function parseSize(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const match = /^\s*([\d.,]+)\s*([KMGTP]?)i?B?\s*$/i.exec(String(value ?? ''));
  if (!match) {
    return null;
  }
  const number = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(number)) {
    return null;
  }
  const power = { '': 3, K: 2, M: 1, G: 0, T: -1, P: -2 }[match[2].toUpperCase()];
  // No suffix: bytes.
  const gigabytes = match[2] === '' ? number / 1024 ** 3 : number / 1024 ** power;
  return Math.round(gigabytes * 100) / 100;
}

/** A percentage ("28%", 28, "28") as a number, null when it cannot be read. */
export function parsePercent(value) {
  const number = Number(
    String(value ?? '')
      .replace('%', '')
      .trim(),
  );
  return value === null || value === undefined || value === '' || !Number.isFinite(number)
    ? null
    : number;
}

/** mailcow answers its counters and flags as numbers or as strings. */
function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function isActive(value) {
  return value === true || value === 1 || value === '1';
}

/** A list answer, whatever shape the version gives it (array, object, single entry). */
function listOf(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload && typeof payload === 'object') {
    // A single entry, or an object keyed by id.
    return 'id' in payload || 'username' in payload || 'domain_name' in payload
      ? [payload]
      : Object.values(payload).filter((entry) => entry && typeof entry === 'object');
  }
  return [];
}

export function readContainers(payload) {
  const entries = payload && typeof payload === 'object' ? Object.entries(payload) : [];
  return entries
    .filter(([, entry]) => entry && typeof entry === 'object')
    .map(([key, entry]) => ({
      name: containerName(key, entry),
      state: String(entry.state ?? 'unknown').toLowerCase(),
      running: String(entry.state ?? '').toLowerCase() === 'running',
      image: entry.image ?? null,
      startedAt: entry.started_at ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function readStorage(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const usedGb = parseSize(payload.used);
  const totalGb = parseSize(payload.total);
  let usedPercent = parsePercent(payload.used_percent);
  if (usedPercent === null && usedGb !== null && totalGb) {
    usedPercent = Math.round((usedGb / totalGb) * 100);
  }
  return { usedGb, totalGb, usedPercent };
}

export function readQueue(payload) {
  const items = listOf(payload);
  const byQueue = (name) => items.filter((item) => item.queue_name === name).length;
  return {
    total: items.length,
    deferred: byQueue('deferred'),
    hold: byQueue('hold'),
    active: byQueue('active'),
  };
}

export function readQuarantine(payload) {
  const items = listOf(payload)
    .map((item) => ({
      id: toNumber(item.id),
      qid: item.qid ?? null,
      sender: String(item.sender ?? ''),
      recipient: String(item.rcpt ?? item.recipient ?? ''),
      subject: String(item.subject ?? ''),
      score: Math.round(toNumber(item.score) * 100) / 100,
      virus: isActive(item.virus_flag),
      createdAt: item.created ? new Date(toNumber(item.created) * 1000).toISOString() : null,
    }))
    .sort((a, b) => b.id - a.id);
  return {
    total: items.length,
    maxId: items.length > 0 ? items[0].id : 0,
    items: items.slice(0, QUARANTINE_KEPT),
  };
}

export function readBans(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const active = (Array.isArray(payload.active_bans) ? payload.active_bans : [])
    .map((ban) => String(ban?.network ?? ban?.ip ?? ban ?? ''))
    .filter(Boolean);
  const permanent = Array.isArray(payload.perm_bans) ? payload.perm_bans.length : 0;
  return { active: [...new Set(active)].sort(), permanent };
}

export function readDomains(payload) {
  return listOf(payload)
    .filter((entry) => entry.domain_name)
    .map((entry) => ({
      name: String(entry.domain_name).toLowerCase(),
      active: isActive(entry.active),
      mailboxes: toNumber(entry.mboxes_in_domain),
      aliases: toNumber(entry.aliases_in_domain),
      messages: toNumber(entry.msgs_total),
      usedGb: Math.round((toNumber(entry.bytes_total) / 1024 ** 3) * 100) / 100,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function readMailboxes(payload) {
  return listOf(payload)
    .filter((entry) => entry.username)
    .map((entry) => {
      const quotaBytes = toNumber(entry.quota);
      const usedBytes = toNumber(entry.quota_used);
      // `percent_in_use` is "- " for an unlimited mailbox on some versions.
      let percent = parsePercent(entry.percent_in_use);
      if (percent === null) {
        percent = quotaBytes > 0 ? Math.round((usedBytes / quotaBytes) * 100) : 0;
      }
      return {
        username: String(entry.username).toLowerCase(),
        domain: String(entry.domain ?? String(entry.username).split('@')[1] ?? '').toLowerCase(),
        name: entry.name ? String(entry.name) : '',
        active: isActive(entry.active),
        quotaGb: Math.round((quotaBytes / 1024 ** 3) * 100) / 100,
        usedGb: Math.round((usedBytes / 1024 ** 3) * 100) / 100,
        percent,
        messages: toNumber(entry.messages),
      };
    })
    .sort((a, b) => a.username.localeCompare(b.username));
}

// The sections read after the version: endpoint and reader.
const SECTIONS = {
  containers: ['get/status/containers', readContainers],
  storage: ['get/status/vmail', readStorage],
  queue: ['get/mailq/all', readQueue],
  quarantine: ['get/quarantine/all', readQuarantine],
  bans: ['get/fail2ban', readBans],
  domains: ['get/domain/all', readDomains],
  mailboxes: ['get/mailbox/all', readMailboxes],
};

/**
 * Read the whole server. Throws (a MailcowError) when the server does not
 * answer or refuses the key; a section that fails on its own is `null`.
 *
 * @param {import('./client.js').MailcowClient} client
 * @param {object} [options]
 * @param {() => Date} [options.now]
 */
export async function readSnapshot(client, { now = () => new Date() } = {}) {
  const versionPayload = await client.get('get/status/version');
  const snapshot = {
    at: now().toISOString(),
    version: versionPayload?.version ? String(versionPayload.version) : null,
    errors: {},
  };
  const keys = Object.keys(SECTIONS);
  const results = await Promise.allSettled(keys.map((key) => client.get(SECTIONS[key][0])));
  results.forEach((result, index) => {
    const key = keys[index];
    if (result.status === 'fulfilled') {
      try {
        snapshot[key] = SECTIONS[key][1](result.value);
        return;
      } catch (err) {
        snapshot.errors[key] = `unreadable answer: ${err.message}`;
      }
    } else {
      snapshot.errors[key] = result.reason?.message ?? String(result.reason);
    }
    snapshot[key] = null;
    logger.debug(`Section ${key} not read: ${snapshot.errors[key]}`);
  });
  return snapshot;
}

/** Counters derived from a snapshot, shared by the server device and the widgets. */
export function summaryOf(snapshot) {
  const containers = snapshot?.containers ?? null;
  return {
    containersRunning: containers ? containers.filter((c) => c.running).length : null,
    containersDown: containers ? containers.filter((c) => !c.running).length : null,
    containersTotal: containers ? containers.length : null,
    stoppedContainers: containers ? containers.filter((c) => !c.running).map((c) => c.name) : [],
    queue: snapshot?.queue?.total ?? null,
    quarantine: snapshot?.quarantine?.total ?? null,
    bans: snapshot?.bans ? snapshot.bans.active.length : null,
    storagePercent: snapshot?.storage?.usedPercent ?? null,
    storageUsedGb: snapshot?.storage?.usedGb ?? null,
    storageTotalGb: snapshot?.storage?.totalGb ?? null,
    domains: snapshot?.domains ? snapshot.domains.length : null,
    mailboxes: snapshot?.mailboxes ? snapshot.mailboxes.length : null,
  };
}
