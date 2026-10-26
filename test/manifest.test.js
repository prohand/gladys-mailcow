// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync,
// and catch on every `npm test` the store rules that are easiest to miss.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG } from '../src/config.js';
import { SCENE_ACTIONS } from '../src/capabilities/scenes.js';
import { WIDGET_KEYS } from '../src/capabilities/widgets.js';
import { SCENE_TRIGGERS } from '../src/mailcow/events.js';
import { KNOWN_CONTAINERS } from '../src/mailcow/snapshot.js';
import { LANGUAGES } from '../src/i18n.js';

const read = async (path) => readFile(new URL(path, import.meta.url), 'utf8');
const manifest = JSON.parse(await read('../gladys-assistant-integration.json'));
const pkg = JSON.parse(await read('../package.json'));
const indexSource = await read('../index.js');

test('version, image tag and package agree (the Release workflow writes all three)', () => {
  assert.equal(manifest.version, pkg.version);
  assert.match(manifest.docker_image, /^ghcr\.io\/prohand\/gladys-mailcow:/);
  assert.ok(manifest.docker_image.endsWith(`:${pkg.version}`));
  assert.match(
    manifest.cover_image,
    /^https:\/\/raw\.githubusercontent\.com\/prohand\/gladys-mailcow\//,
  );
});

test('every manifest action is registered in index.js', () => {
  for (const action of manifest.actions ?? []) {
    assert.match(
      indexSource,
      new RegExp(`onAction\\('${action.key}'`),
      `manifest action "${action.key}" has no handler`,
    );
  }
});

test('every widget is served, and every scene action and trigger exists in the code', () => {
  assert.deepEqual(
    manifest.widgets.map((widget) => widget.key).sort(),
    Object.values(WIDGET_KEYS).sort(),
  );
  assert.match(indexSource, /onWidgetGet\(widgetKey/);
  assert.match(indexSource, /onWidgetAction\(widgetKey/);
  assert.deepEqual(
    manifest.scene_actions.map((action) => action.key).sort(),
    Object.keys(SCENE_ACTIONS).sort(),
  );
  assert.match(indexSource, /onSceneAction\(actionKey/);
  assert.deepEqual(
    manifest.scene_triggers.map((trigger) => trigger.key).sort(),
    Object.values(SCENE_TRIGGERS).sort(),
  );
});

test('the container filter offers the containers the code knows', () => {
  for (const key of [SCENE_TRIGGERS.CONTAINER_DOWN, SCENE_TRIGGERS.CONTAINER_UP]) {
    const field = manifest.scene_triggers
      .find((trigger) => trigger.key === key)
      .fields.find((f) => f.key === 'container');
    assert.deepEqual(
      field.options.map((option) => option.value),
      KNOWN_CONTAINERS,
    );
  }
});

// The store schema is the admission authority: a field type outside this list,
// or a placeholder that is not a multi-language object, gets the integration
// rejected by the indexer.
const FIELD_TYPES = ['string', 'number', 'boolean', 'select', 'multi_select', 'secret', 'section'];

test('every field uses a type the store accepts', () => {
  const allFields = [
    ...manifest.config_schema,
    ...(manifest.actions ?? []).flatMap((a) => a.fields ?? []),
    ...(manifest.widgets ?? []).flatMap((w) => w.settings ?? []),
    ...(manifest.scene_triggers ?? []).flatMap((t) => t.fields ?? []),
    ...(manifest.scene_actions ?? []).flatMap((a) => a.fields ?? []),
  ];
  for (const field of allFields) {
    assert.ok(FIELD_TYPES.includes(field.type), `field "${field.key}": type "${field.type}"`);
    assert.match(field.key, /^[a-z0-9_]+$/, `field key "${field.key}" must be snake_case`);
    if (field.placeholder !== undefined) {
      assert.equal(typeof field.placeholder, 'object', `field "${field.key}": placeholder object`);
      assert.ok(
        ['string', 'number', 'secret'].includes(field.type),
        `field "${field.key}": a ${field.type} field cannot have a placeholder`,
      );
    }
    if (field.min !== undefined || field.max !== undefined) {
      assert.equal(field.type, 'number', `field "${field.key}": min/max are number-only`);
    }
  }
  // No boolean filter on a trigger: a toggle has no "any" state.
  for (const field of manifest.scene_triggers.flatMap((t) => t.fields ?? [])) {
    assert.notEqual(field.type, 'boolean', `trigger field "${field.key}"`);
    assert.notEqual(field.type, 'secret', `trigger field "${field.key}"`);
  }
  // Nothing secret in a dashboard or a scene: they are readable by every user.
  for (const field of [
    ...manifest.widgets.flatMap((w) => w.settings ?? []),
    ...manifest.scene_actions.flatMap((a) => a.fields ?? []),
  ]) {
    assert.notEqual(field.type, 'secret', `field "${field.key}"`);
  }
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.type === 'section') {
      assert.ok(!(field.key in DEFAULT_CONFIG), `section "${field.key}" stores no value`);
      assert.equal(field.default, undefined, `section "${field.key}"`);
      assert.equal(field.required, undefined, `section "${field.key}"`);
      for (const link of field.links ?? []) {
        assert.match(link.url, /^https:\/\//, 'section links must be https');
      }
      continue;
    }
    assert.ok(field.key in DEFAULT_CONFIG, `config key "${field.key}" missing in DEFAULT_CONFIG`);
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, `default of ${field.key}`);
    }
  }
});

test('both transports are declared: the LAN address and the public one', () => {
  assert.deepEqual(manifest.transports, ['local', 'cloud']);
  assert.ok(manifest.config_schema.some((field) => field.key === 'local_url'));
  assert.ok(manifest.config_schema.some((field) => field.key === 'public_url'));
  // Reserved: Gladys owns it, the manifest must not declare it.
  assert.ok(!manifest.config_schema.some((field) => field.key === 'GLADYS_PREFER_LOCAL'));
});

// The vocabulary the store indexes: an unknown key is silently dropped.
const CATEGORIES = [
  'climate',
  'lighting',
  'energy',
  'security',
  'multimedia',
  'appliances',
  'environment',
  'protocols',
  'network',
  'notifications',
  'assistants',
  'services',
  'transport',
  'vehicles',
  'servers',
  'leisure',
];

test('categories and keywords follow the store rules', () => {
  const { categories, keywords } = manifest;
  assert.ok(categories.length >= 1 && categories.length <= 3);
  for (const category of categories) {
    assert.ok(CATEGORIES.includes(category), `unknown category "${category}"`);
  }
  assert.ok(keywords.length >= 1 && keywords.length <= 10);
  const normalized = keywords.map((keyword) => keyword.trim().toLowerCase());
  assert.equal(new Set(normalized).size, keywords.length, 'keywords must be unique');
  for (const keyword of normalized) {
    assert.ok(keyword.length >= 2 && keyword.length <= 30, `keyword "${keyword}"`);
  }
});

test('the Gladys floor covers every field the manifest declares', () => {
  // `categories` needs 4.86, widgets and scenes 5.1, `keywords` 5.3.
  assert.equal(manifest.gladys_version, '>=5.3.0');
});

/** Every multi-language object of the manifest, with where it sits. */
function multiLanguageTexts(node, path = 'manifest') {
  if (Array.isArray(node)) {
    return node.flatMap((child, index) => multiLanguageTexts(child, `${path}[${index}]`));
  }
  if (node === null || typeof node !== 'object') {
    return [];
  }
  const keys = Object.keys(node);
  if (keys.includes('en') && keys.every((key) => /^[a-z]{2}$/.test(key))) {
    return [{ path, text: node }];
  }
  return keys.flatMap((key) => multiLanguageTexts(node[key], `${path}.${key}`));
}

test('every text of the manifest is in English, French, German and Spanish', () => {
  const texts = multiLanguageTexts(manifest);
  assert.ok(texts.length > 100, `only ${texts.length} texts found`);
  for (const { path, text } of texts) {
    assert.deepEqual(Object.keys(text).sort(), [...LANGUAGES].sort(), `${path}: languages`);
    for (const language of LANGUAGES) {
      assert.ok(text[language].trim().length > 0, `${path}.${language} is empty`);
    }
  }
});

test('the length limits of the store hold in every language', () => {
  const within = (text, min, max, where) => {
    for (const language of LANGUAGES) {
      const { length } = text[language];
      assert.ok(length >= min && length <= max, `${where}.${language}: ${length} characters`);
    }
  };
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  within(manifest.description, 10, 100, 'description');
  for (const widget of manifest.widgets) {
    within(widget.label, 3, 30, `widget ${widget.key} label`);
    within(widget.description, 1, 100, `widget ${widget.key} description`);
  }
  for (const section of manifest.config_schema.filter((field) => field.type === 'section')) {
    within(section.description, 1, 1000, `section ${section.key} description`);
  }
  for (const entry of [...manifest.scene_triggers, ...manifest.scene_actions]) {
    assert.ok(entry.key.length <= 40, entry.key);
  }
});

test('the cover is a PNG of 800×534 px, 150 KB at most', async () => {
  const cover = await readFile(new URL('../cover.png', import.meta.url));
  assert.ok(cover.length <= 150 * 1024, `${cover.length} bytes`);
  assert.equal(cover.toString('ascii', 1, 4), 'PNG');
  assert.equal(cover.readUInt32BE(16), 800);
  assert.equal(cover.readUInt32BE(20), 534);
});

test('the user documentation exists in the four languages', async () => {
  for (const language of LANGUAGES) {
    const text = await read(`../docs/${language}.md`);
    assert.ok(text.length > 1000, `docs/${language}.md is too short`);
    // Every trigger and scene action is documented under its key.
    for (const key of [...Object.values(SCENE_TRIGGERS), ...Object.keys(SCENE_ACTIONS)]) {
      assert.ok(text.includes(`\`${key}\``), `docs/${language}.md does not name ${key}`);
    }
  }
});
