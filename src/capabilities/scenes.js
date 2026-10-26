// -----------------------------------------------------------------------------
// Scene actions (SDK v0.14+, Gladys 5.1+).
//
// A scene action is an OPERATION a scene author places in a scene, declared in
// the manifest `scene_actions` field and handled here under that same key
// (index.js registers each one with `gladys.onSceneAction`). The handler
// receives the RESOLVED fields and resolves the declared `outputs` (scalars
// only); throwing fails this action alone, the scene goes on.
//
// The scene TRIGGERS are the other direction ("this happened"): they are fired
// by the refresh loop, see src/mailcow/events.js.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { summaryOf } from '../mailcow/snapshot.js';

const logger = createLogger({ name: 'scenes' });

export const SCENE_ACTIONS = {
  // Read the server now, and hand the main counters to the next actions: a
  // scene "every morning, refresh then notify me if the queue is not empty".
  async refresh(monitor) {
    logger.info('Scene action refresh');
    const result = await monitor.refresh();
    const summary = summaryOf(result.ok ? result.snapshot : null);
    return {
      reachable: result.ok,
      queue_size: summary.queue,
      quarantine: summary.quarantine,
      containers_down: summary.containersDown,
      storage_percent: summary.storagePercent,
    };
  },

  // `postqueue -f`: try to deliver the waiting mails now (after an outage of
  // the relay host, typically).
  async flush_queue(monitor) {
    logger.info('Scene action flush_queue');
    const waiting = await monitor.flushQueue();
    return { queued_before: waiting };
  },

  // Turn a mailbox on or off: a holiday mailbox, an account to lock at once.
  async set_mailbox_active(monitor, fields) {
    const active = fields.active !== false && fields.active !== 'false';
    logger.info(`Scene action set_mailbox_active <- ${fields.mailbox} = ${active}`);
    const changed = await monitor.setMailboxActive(fields.mailbox, active);
    return { changed };
  },
};
