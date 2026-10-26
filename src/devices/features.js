// -----------------------------------------------------------------------------
// The few feature shapes the mailcow devices are made of.
//
// Every feature declares `min` and `max`: Gladys stores them in NOT NULL
// columns, and a feature without them is refused at creation.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

/** A read-only count (containers, mails, IPs...). */
export function counter(externalId, name, max) {
  return {
    name,
    external_id: externalId,
    category: DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
    min: 0,
    max,
    read_only: true,
    has_feedback: false,
    keep_history: true,
  };
}

/** A read-only amount of data, in gigabytes. */
export function gigabytes(externalId, name) {
  return {
    name,
    external_id: externalId,
    category: DEVICE_FEATURE_CATEGORIES.DATA,
    type: DEVICE_FEATURE_TYPES.DATA.SIZE,
    unit: DEVICE_FEATURE_UNITS.GIGABYTE,
    min: 0,
    max: 1_000_000,
    read_only: true,
    has_feedback: false,
    keep_history: true,
  };
}

/** A read-only share of a storage, in percent. */
export function percent(externalId, name) {
  return {
    name,
    external_id: externalId,
    category: DEVICE_FEATURE_CATEGORIES.DATA,
    type: DEVICE_FEATURE_TYPES.DATA.SIZE,
    unit: DEVICE_FEATURE_UNITS.PERCENT,
    min: 0,
    max: 100,
    read_only: true,
    has_feedback: false,
    keep_history: true,
  };
}

/** A read-only text (the mailcow version). */
export function text(externalId, name) {
  return {
    name,
    external_id: externalId,
    category: DEVICE_FEATURE_CATEGORIES.TEXT,
    type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
    min: 0,
    max: 0,
    read_only: true,
    has_feedback: false,
    keep_history: false,
  };
}

/**
 * The "active" switch of a domain or a mailbox. Controllable only when the
 * configuration allows changes: otherwise Gladys shows it as a read-only
 * state, and nobody disables a domain from a dashboard by mistake.
 */
export function activeSwitch(externalId, name, allowChanges) {
  return {
    name,
    external_id: externalId,
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
    min: 0,
    max: 1,
    read_only: !allowChanges,
    has_feedback: true,
    keep_history: true,
  };
}
