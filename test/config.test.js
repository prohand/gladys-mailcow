import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, isConfigured, normalizeConfig, normalizeUrl } from '../src/config.js';

test('an empty configuration gets the defaults', () => {
  const config = normalizeConfig();
  for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
    assert.deepEqual(config[key], value, key);
  }
  assert.equal(isConfigured(config), false);
});

test('a bare host name becomes an https URL, without path or trailing slash', () => {
  assert.equal(normalizeUrl('mail.example.com'), 'https://mail.example.com');
  assert.equal(normalizeUrl(' https://mail.example.com/ '), 'https://mail.example.com');
  assert.equal(normalizeUrl('https://mail.example.com/api/v1/'), 'https://mail.example.com');
  assert.equal(normalizeUrl('http://192.168.1.20:8080'), 'http://192.168.1.20:8080');
  assert.equal(
    normalizeUrl('https://mail.example.com/mailcow/'),
    'https://mail.example.com/mailcow',
  );
});

test('anything but http(s) is no address, and credentials never stay in the URL', () => {
  assert.equal(normalizeUrl('ftp://mail.example.com'), '');
  assert.equal(normalizeUrl(''), '');
  assert.equal(normalizeUrl(undefined), '');
  assert.equal(normalizeUrl('https://user:pass@mail.example.com'), 'https://mail.example.com');
});

test('numbers typed as strings are read, and kept within their bounds', () => {
  const config = normalizeConfig({
    poll_frequency: '10',
    queue_threshold: '50',
    storage_threshold: '150',
    quota_threshold: '',
  });
  assert.equal(config.poll_frequency, 60, 'one minute minimum');
  assert.equal(config.queue_threshold, 50);
  assert.equal(config.storage_threshold, 100);
  assert.equal(config.quota_threshold, DEFAULT_CONFIG.quota_threshold);
});

test('the booleans and the local preference', () => {
  const config = normalizeConfig({ verify_tls: 'false', allow_changes: true });
  assert.equal(config.verify_tls, false);
  assert.equal(config.allow_changes, true);
  assert.equal(config.GLADYS_PREFER_LOCAL, true, 'true unless explicitly false');
  assert.equal(normalizeConfig({ GLADYS_PREFER_LOCAL: false }).GLADYS_PREFER_LOCAL, false);
});

test('one address and a key are enough', () => {
  assert.ok(isConfigured(normalizeConfig({ public_url: 'mail.example.com', api_key: 'k' })));
  assert.ok(isConfigured(normalizeConfig({ local_url: '192.168.1.20', api_key: ' k ' })));
  assert.equal(isConfigured(normalizeConfig({ local_url: '192.168.1.20' })), false);
  assert.equal(normalizeConfig({ api_key: ' k ' }).api_key, 'k');
});
