# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) and to human contributors when
working with code in this repository.

## What this is

A Gladys Assistant **external integration** (Node 22+, ESM, no build step, one runtime
dependency: `@gladysassistant/integration-sdk`) for a **mailcow: dockerized** mail server. It
started from the official JavaScript template
([GladysAssistant/integration-template-js](https://github.com/GladysAssistant/integration-template-js))
and runs in its own sandboxed Docker container. Requires Gladys 5.3+ (manifest `keywords`).

It reads the mailcow API (`/api/v1`, `X-API-Key`) every `poll_frequency` seconds and publishes:
a server device (containers, queue, quarantine, fail2ban bans, storage, version), optional
domain and mailbox devices, transport badges (local / cloud), scene triggers, scene actions and
three dashboard widgets.

## Commands

```bash
npm install
npm test                                    # node --test (built-in runner)
node --test test/monitor.test.js            # one file
node --test --test-name-pattern "fallback"  # one test by name
npm run lint                                # eslint .
npm run format:check                        # prettier --check . (CI gate)
npm run format                              # prettier --write .
npx github:GladysAssistant/integration-store --skip-image-check .   # store admission checks
```

CI (`.github/workflows/ci.yml`) runs `format:check`, `lint`, `test` on Node 22 and 24; pull
requests also build the image and run the store checks. Releases: **Actions → Release** only
(bumps `package.json`, manifest `version` + `docker_image`, rolls `CHANGELOG.md`, tags, builds
the multi-arch image, publishes the GitHub Release).

## Architecture

```
index.js                    SDK bootstrap + wiring only (handlers registered before connect())
src/config.js               DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
src/i18n.js                 LANGUAGES (en, fr, de, es), pick / localize
src/logging.js              "Detailed logs" box -> LOG_LEVEL
src/mailcow/client.js       HTTP client: local/cloud addresses, fallback, badge, error codes
src/mailcow/snapshot.js     one read of the whole server -> plain object (+ summaryOf)
src/mailcow/events.js       two snapshots -> scene events (SCENE_TRIGGERS)
src/mailcow/monitor.js      refresh loop: publish devices, states, badges, status, events
src/mailcow/messages.js     user-facing texts: errors, "Test the connection"
src/devices/                server, domain, mailbox blueprints + registry (index.js)
src/capabilities/scenes.js  scene actions (manifest `scene_actions`)
src/capabilities/widgets.js dashboard widgets (manifest `widgets`)
docs/{en,fr,de,es}.md       user documentation, re-hosted by Gladys (mandatory)
test/                       node --test; test/helpers/fakeMailcow.js fakes the API
.github/scripts/changelog-release.mjs   rolls the changelog, tested in test/
```

### Invariants worth knowing

- **One read for everything.** The monitor reads one snapshot per interval; devices, widgets
  and events all derive from it. Devices are NOT polled by Gladys (no `poll_frequency`).
- **Events come from two snapshots.** The first read after a start or a configuration change
  is a baseline and fires nothing; thresholds fire when crossed upwards only; bursts are capped
  (`MAX_EVENTS_PER_KIND`).
- **Transports.** `local_url` is the `local` transport, `public_url` the `cloud` one.
  `GLADYS_PREFER_LOCAL` (reserved key, read-only) orders them. Only an address that does not
  answer (network, timeout, TLS) falls back to the other one; an HTTP answer (401, 403...) never
  does. A fallback is published as a **degraded** badge.
- **TLS.** `verify_tls` applies to the LAN address only; the public address is always checked.
- **Read-only by default.** Every write (`edit/mailq`, `edit/domain`, `edit/mailbox`) goes
  through `monitor.assertChangesAllowed()` (`allow_changes`). The "active" switches are
  `read_only` while changes are off.
- **Every feature declares `min`/`max`** (NOT NULL in Gladys), text features included.
- **States** go through `publishChangedStates` (300 states/min limit), with a 30 min heartbeat.
- The API key is a secret: never log it, never put it in an error message.
- External ids: `server:mailcow`, `domain:<domain>`, `mailbox:<address>`. Trigger, action,
  widget and config keys are stored by users: never rename them.

## Rules

- **Versions belong to the Release workflow.** Never edit `version` in `package.json` or the
  manifest, nor the `docker_image` tag, by hand. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]` in
  `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`). Never write a
  version heading.
- **Manifest.** Every text is `{ en, fr, de, es }` (labels, descriptions, placeholders). The
  catalog `description` holds 10 to 100 characters per language. `test/manifest.test.js` ties
  the manifest to the code (defaults, actions, scene and widget keys, docs): change both sides
  together.
- **User-facing text** (action answers, connection status, widget texts, docs) exists in the
  four languages, kept in sync: `docs/en.md`, `docs/fr.md`, `docs/de.md`, `docs/es.md`.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why, in English.
  Tests never touch the network (the fake API in `test/helpers/fakeMailcow.js`, the fake Gladys
  of the SDK, a loopback server at most).
