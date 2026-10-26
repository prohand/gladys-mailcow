// -----------------------------------------------------------------------------
// Device registry.
//
// The devices are not hard-coded: they follow the server. Each refresh gives
// a snapshot (src/mailcow/snapshot.js), and the devices are the server itself
// plus, when the configuration asks for them, one per domain and one per
// mailbox of that snapshot. Each type lives in its own file with the same
// shape:
//   - type                        : the device type namespace of its ids
//   - ids(gladys, entry)          : `gladys.externalIds(type, platformId)`
//   - list(snapshot, config)      : the entries to publish (not the server)
//   - buildDevice(gladys, entry, config): the discovery payload
//   - states(gladys, entry)       : its states, from the snapshot
//   - activation(entry, active)   : the API call behind its "active" switch
// -----------------------------------------------------------------------------

import { server } from './server.js';
import { domain, DOMAIN_FEATURES } from './domain.js';
import { mailbox, MAILBOX_FEATURES } from './mailbox.js';

const LISTED = [domain, mailbox];

/** Every device to publish: the server first, then the domains and mailboxes. */
export function buildDiscoveredDevices(gladys, snapshot, config) {
  return [
    server.buildDevice(gladys),
    ...LISTED.flatMap((blueprint) =>
      blueprint.list(snapshot, config).map((entry) => blueprint.buildDevice(gladys, entry, config)),
    ),
  ];
}

/** Every state of a snapshot, in the publishStates format. */
export function buildStates(gladys, snapshot, config) {
  if (!snapshot) {
    return [];
  }
  return [
    ...server.states(gladys, snapshot),
    ...LISTED.flatMap((blueprint) =>
      blueprint.list(snapshot, config).flatMap((entry) => blueprint.states(gladys, entry)),
    ),
  ];
}

/** The external id of every published device (transport badges). */
export function deviceExternalIds(gladys, snapshot, config) {
  return buildDiscoveredDevices(gladys, snapshot, config).map((device) => device.external_id);
}

/**
 * The device behind an external id: `{ blueprint, entry }` (entry null for
 * the server), or null when it is not (or no longer) one of ours.
 */
export function findDevice(gladys, snapshot, config, externalId) {
  if (server.ids(gladys).device === externalId) {
    return { blueprint: server, entry: null };
  }
  for (const blueprint of LISTED) {
    const entry = blueprint
      .list(snapshot, config)
      .find((candidate) => blueprint.ids(gladys, candidate).device === externalId);
    if (entry) {
      return { blueprint, entry };
    }
  }
  return null;
}

/** Whether a feature external id is the "active" switch of its device. */
export function isActiveFeature(externalId) {
  return [DOMAIN_FEATURES.ACTIVE, MAILBOX_FEATURES.ACTIVE].some((key) =>
    externalId.endsWith(`:${key}`),
  );
}

export { server, domain, mailbox };
