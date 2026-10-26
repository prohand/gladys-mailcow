// -----------------------------------------------------------------------------
// Device type: a MAILBOX of the server (one device per mailbox).
//
// Its quota use, messages and storage, and whether it is active — a switch
// Gladys can flip when the configuration allows changes. Off by default
// (`mailbox_devices`): a family server has a handful of mailboxes worth a
// device each, a company one has hundreds nobody wants in Gladys.
// -----------------------------------------------------------------------------

import { activeSwitch, counter, gigabytes, percent } from './features.js';

const DEVICE_TYPE = 'mailbox';

// Past this many, the mailboxes are not published as devices: Gladys
// discovery is not meant for a directory.
export const MAX_MAILBOX_DEVICES = 200;

export const MAILBOX_FEATURES = {
  ACTIVE: 'active',
  QUOTA_PERCENT: 'quota-percent',
  STORAGE_USED: 'storage-used',
  MESSAGES: 'messages',
};

export const mailbox = {
  type: DEVICE_TYPE,

  // The address is the id mailcow itself keys the mailbox on.
  ids(gladys, entry) {
    return gladys.externalIds(DEVICE_TYPE, entry.username);
  },

  list(snapshot, config) {
    return config.mailbox_devices ? (snapshot?.mailboxes ?? []).slice(0, MAX_MAILBOX_DEVICES) : [];
  },

  buildDevice(gladys, entry, config) {
    const ids = this.ids(gladys, entry);
    const f = (key) => ids.feature(key);
    return {
      name: entry.username,
      external_id: ids.device,
      features: [
        activeSwitch(f(MAILBOX_FEATURES.ACTIVE), 'Mailbox active', config.allow_changes),
        percent(f(MAILBOX_FEATURES.QUOTA_PERCENT), 'Quota used (%)'),
        gigabytes(f(MAILBOX_FEATURES.STORAGE_USED), 'Storage used'),
        counter(f(MAILBOX_FEATURES.MESSAGES), 'Messages', 100_000_000),
      ],
    };
  },

  states(gladys, entry) {
    const ids = this.ids(gladys, entry);
    return [
      [MAILBOX_FEATURES.ACTIVE, entry.active ? 1 : 0],
      [MAILBOX_FEATURES.QUOTA_PERCENT, Math.min(100, entry.percent)],
      [MAILBOX_FEATURES.STORAGE_USED, entry.usedGb],
      [MAILBOX_FEATURES.MESSAGES, entry.messages],
    ].map(([key, state]) => ({ device_feature_external_id: ids.feature(key), state }));
  },

  /** The API call that turns the mailbox on or off. */
  activation(entry, active) {
    return ['edit/mailbox', { items: [entry.username], attr: { active: active ? '1' : '0' } }];
  },
};
