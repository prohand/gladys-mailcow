// -----------------------------------------------------------------------------
// Device type: a mail DOMAIN of the server (one device per domain).
//
// Its mailboxes, messages and storage, and whether it is active — a switch
// Gladys can flip when the configuration allows changes (`allow_changes`,
// read-write API key). Published when `domain_devices` is on.
// -----------------------------------------------------------------------------

import { activeSwitch, counter, gigabytes } from './features.js';

const DEVICE_TYPE = 'domain';

export const DOMAIN_FEATURES = {
  ACTIVE: 'active',
  MAILBOXES: 'mailboxes',
  ALIASES: 'aliases',
  MESSAGES: 'messages',
  STORAGE_USED: 'storage-used',
};

export const domain = {
  type: DEVICE_TYPE,

  // The domain name is the id mailcow itself keys the domain on.
  ids(gladys, entry) {
    return gladys.externalIds(DEVICE_TYPE, entry.name);
  },

  list(snapshot, config) {
    return config.domain_devices ? (snapshot?.domains ?? []) : [];
  },

  buildDevice(gladys, entry, config) {
    const ids = this.ids(gladys, entry);
    const f = (key) => ids.feature(key);
    return {
      name: `mailcow ${entry.name}`,
      external_id: ids.device,
      features: [
        activeSwitch(f(DOMAIN_FEATURES.ACTIVE), 'Domain active', config.allow_changes),
        counter(f(DOMAIN_FEATURES.MAILBOXES), 'Mailboxes', 1_000_000),
        counter(f(DOMAIN_FEATURES.ALIASES), 'Aliases', 1_000_000),
        counter(f(DOMAIN_FEATURES.MESSAGES), 'Messages', 1_000_000_000),
        gigabytes(f(DOMAIN_FEATURES.STORAGE_USED), 'Storage used'),
      ],
    };
  },

  states(gladys, entry) {
    const ids = this.ids(gladys, entry);
    return [
      [DOMAIN_FEATURES.ACTIVE, entry.active ? 1 : 0],
      [DOMAIN_FEATURES.MAILBOXES, entry.mailboxes],
      [DOMAIN_FEATURES.ALIASES, entry.aliases],
      [DOMAIN_FEATURES.MESSAGES, entry.messages],
      [DOMAIN_FEATURES.STORAGE_USED, entry.usedGb],
    ].map(([key, state]) => ({ device_feature_external_id: ids.feature(key), state }));
  },

  /** The API call that turns the domain on or off. */
  activation(entry, active) {
    return ['edit/domain', { items: [entry.name], attr: { active: active ? '1' : '0' } }];
  },
};
