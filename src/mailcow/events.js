// -----------------------------------------------------------------------------
// What changed between two reads of the server, as scene events.
//
// A device state says "how it is" (12 mails in the queue); a scene event says
// "this just happened, with these details" (the queue went over the
// threshold, a container stopped, a mail was quarantined). Events are only
// derived from two successive snapshots: the first read after a start is the
// baseline and fires nothing, so a restart of Gladys never replays the whole
// quarantine nor "discovers" a container that has been down for a week.
//
// Every key below is declared in the manifest `scene_triggers` (scenes store
// them: never rename one), and the `data` of each event only carries the keys
// its trigger declares in `fields` and `variables` (test/events.test.js).
// -----------------------------------------------------------------------------

export const SCENE_TRIGGERS = {
  CONTAINER_DOWN: 'container_down',
  CONTAINER_UP: 'container_up',
  QUEUE_HIGH: 'queue_high',
  STORAGE_HIGH: 'storage_high',
  QUOTA_HIGH: 'quota_high',
  QUARANTINE_NEW: 'quarantine_new',
  IP_BANNED: 'ip_banned',
  CONNECTION_LOST: 'connection_lost',
  CONNECTION_RESTORED: 'connection_restored',
};

// A burst (a spam wave filling the quarantine, a scan getting a range banned)
// must not use up the 300 events a minute the core accepts: past this many of
// one kind in one read, the rest is dropped and the counters tell the story.
export const MAX_EVENTS_PER_KIND = 10;

/** Whether `value` went from below `threshold` to at least `threshold`. */
function crossed(before, after, threshold) {
  return (
    typeof before === 'number' &&
    typeof after === 'number' &&
    before < threshold &&
    after >= threshold
  );
}

function containerEvents(previous, next) {
  if (!previous || !next) {
    return [];
  }
  const before = new Map(previous.map((container) => [container.name, container]));
  const events = [];
  for (const container of next) {
    const old = before.get(container.name);
    before.delete(container.name);
    if (!old) {
      continue;
    }
    if (old.running && !container.running) {
      events.push({
        key: SCENE_TRIGGERS.CONTAINER_DOWN,
        data: { container: container.name, state: container.state },
      });
    } else if (!old.running && container.running) {
      events.push({ key: SCENE_TRIGGERS.CONTAINER_UP, data: { container: container.name } });
    }
  }
  // A container that vanished from the list was removed or crashed for good.
  for (const old of before.values()) {
    if (old.running) {
      events.push({
        key: SCENE_TRIGGERS.CONTAINER_DOWN,
        data: { container: old.name, state: 'missing' },
      });
    }
  }
  return events;
}

function quotaEvents(previous, next, threshold) {
  if (!previous || !next) {
    return [];
  }
  const before = new Map(previous.map((mailbox) => [mailbox.username, mailbox.percent]));
  return next
    .filter((mailbox) => crossed(before.get(mailbox.username), mailbox.percent, threshold))
    .slice(0, MAX_EVENTS_PER_KIND)
    .map((mailbox) => ({
      key: SCENE_TRIGGERS.QUOTA_HIGH,
      data: {
        mailbox: mailbox.username,
        domain: mailbox.domain,
        percent: mailbox.percent,
        threshold,
      },
    }));
}

function quarantineEvents(previous, next) {
  if (!previous || !next) {
    return [];
  }
  return next.items
    .filter((item) => item.id > previous.maxId)
    .slice(0, MAX_EVENTS_PER_KIND)
    .map((item) => ({
      key: SCENE_TRIGGERS.QUARANTINE_NEW,
      data: {
        sender: item.sender,
        recipient: item.recipient,
        subject: item.subject,
        score: item.score,
        virus: item.virus,
      },
    }));
}

function banEvents(previous, next) {
  if (!previous || !next) {
    return [];
  }
  const before = new Set(previous.active);
  return next.active
    .filter((ip) => !before.has(ip))
    .slice(0, MAX_EVENTS_PER_KIND)
    .map((ip) => ({ key: SCENE_TRIGGERS.IP_BANNED, data: { ip } }));
}

/**
 * The scene events between two snapshots. `previous` null (first read):
 * nothing.
 *
 * @param {object | null} previous
 * @param {object} next
 * @param {object} config the normalized configuration (thresholds)
 * @returns {{ key: string, data: Record<string, string | number | boolean> }[]}
 */
export function diffSnapshots(previous, next, config) {
  if (!previous || !next) {
    return [];
  }
  const events = [...containerEvents(previous.containers, next.containers)];
  if (crossed(previous.queue?.total, next.queue?.total, config.queue_threshold)) {
    events.push({
      key: SCENE_TRIGGERS.QUEUE_HIGH,
      data: { queue_size: next.queue.total, threshold: config.queue_threshold },
    });
  }
  if (crossed(previous.storage?.usedPercent, next.storage?.usedPercent, config.storage_threshold)) {
    events.push({
      key: SCENE_TRIGGERS.STORAGE_HIGH,
      data: { used_percent: next.storage.usedPercent, threshold: config.storage_threshold },
    });
  }
  events.push(...quotaEvents(previous.mailboxes, next.mailboxes, config.quota_threshold));
  events.push(...quarantineEvents(previous.quarantine, next.quarantine));
  events.push(...banEvents(previous.bans, next.bans));
  return events;
}

/**
 * The event of a change of reachability: lost when a server that answered
 * stops answering, restored when it answers again. Nothing on the first read
 * (unknown before), nor while it stays the same.
 *
 * @param {boolean | null} wasReachable null before the first read
 * @param {boolean} isReachable
 * @param {object} details `{ error }` when lost, `{ transport }` when restored
 */
export function reachabilityEvent(wasReachable, isReachable, { error, transport } = {}) {
  if (wasReachable === true && !isReachable) {
    return {
      key: SCENE_TRIGGERS.CONNECTION_LOST,
      data: { reason: error?.code ?? 'unknown', message: error?.message ?? '' },
    };
  }
  if (wasReachable === false && isReachable) {
    return { key: SCENE_TRIGGERS.CONNECTION_RESTORED, data: { transport: transport ?? '' } };
  }
  return null;
}
