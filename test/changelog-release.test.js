import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { rollChangelog } from '../.github/scripts/changelog-release.mjs';

const SAMPLE = `# Changelog

Describe each change under \`## [Unreleased]\` as you make it.

## [Unreleased]

### Added

- Something new.

[Unreleased]: https://github.com/prohand/gladys-mailcow/commits/main
`;

test('the Unreleased section moves under the released version', () => {
  const rolled = rollChangelog(SAMPLE, '1.0.0', '2026-10-26');
  assert.match(
    rolled,
    /## \[Unreleased\]\n\n## \[1\.0\.0\] - 2026-10-26\n\n### Added\n\n- Something new\./,
  );
  assert.match(
    rolled,
    /\[Unreleased\]: https:\/\/github\.com\/prohand\/gladys-mailcow\/compare\/v1\.0\.0\.\.\.HEAD/,
  );
  assert.match(
    rolled,
    /\[1\.0\.0\]: https:\/\/github\.com\/prohand\/gladys-mailcow\/releases\/tag\/v1\.0\.0/,
  );
});

test('the next release compares with the previous tag', () => {
  const first = rollChangelog(SAMPLE, '1.0.0', '2026-10-26');
  const second = rollChangelog(
    first.replace('## [Unreleased]\n', '## [Unreleased]\n\n- Fix.\n'),
    '1.0.1',
    '2026-10-27',
  );
  assert.match(second, /\[1\.0\.1\]: .*\/compare\/v1\.0\.0\.\.\.v1\.0\.1/);
});

test('a release with nothing listed says so, and a version is never rolled twice', () => {
  const empty = rollChangelog(
    SAMPLE.replace(/### Added\n\n- Something new\.\n\n/, ''),
    '1.0.0',
    '2026-10-26',
  );
  assert.match(empty, /Maintenance release, no functional change/);
  assert.equal(rollChangelog(empty, '1.0.0', '2026-10-26'), empty);
});

test('the real changelog has an Unreleased section and no hand-written version', async () => {
  const changelog = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  assert.match(changelog, /^## \[Unreleased\][ \t]*$/m);
  assert.match(changelog, /^\[Unreleased\]: https:\/\/github\.com\/prohand\/gladys-mailcow\//m);
});
