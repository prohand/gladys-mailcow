# Mailcow for Gladys Assistant

External integration for [Gladys Assistant](https://gladysassistant.com) that watches a
[mailcow: dockerized](https://mailcow.email) mail server through its API: containers, mail
queue, quarantine, fail2ban bans, storage, domains and mailboxes. Built on the JavaScript SDK
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
from the official
[template](https://github.com/GladysAssistant/integration-template-js).

User documentation: [English](docs/en.md) · [Français](docs/fr.md) · [Deutsch](docs/de.md) ·
[Español](docs/es.md).

## Features

| Surface               | What                                                                                                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Devices               | **mailcow server** (containers up/down, queue, quarantine, banned IPs, storage GB/%, domains, mailboxes, version), one device per **domain**, optional one per **mailbox** |
| Transports            | `local` (LAN address) and `cloud` (public address), "Prefer the local connection" switch, degraded badge on fallback                                                       |
| Scene triggers        | `container_down`, `container_up`, `queue_high`, `storage_high`, `quota_high`, `quarantine_new`, `ip_banned`, `connection_lost`, `connection_restored`                      |
| Scene actions         | `refresh` (counters as outputs), `flush_queue`, `set_mailbox_active`                                                                                                       |
| Dashboard widgets     | `mailcow_status`, `mailcow_quarantine`, `mailcow_mailboxes`                                                                                                                |
| Configuration buttons | Test the connection, Flush the mail queue                                                                                                                                  |
| Languages             | English, French, German, Spanish                                                                                                                                           |

Read-only by default: nothing in Gladys changes mailcow until **Allow changes** is ticked, with a
read-write API key.

## Project structure

```
.
├─ index.js                          # SDK bootstrap + wiring (no mailcow logic)
├─ src/
│  ├─ config.js                      # defaults + normalization
│  ├─ i18n.js                        # en / fr / de / es
│  ├─ logging.js                     # "Detailed logs" switch
│  ├─ mailcow/
│  │  ├─ client.js                   # HTTP client, local/cloud fallback, transport badge
│  │  ├─ snapshot.js                 # one read of the whole server
│  │  ├─ events.js                   # scene triggers from two reads
│  │  ├─ monitor.js                  # refresh loop: devices, states, badges, events
│  │  └─ messages.js                 # user-facing messages
│  ├─ devices/                       # server, domain, mailbox (+ registry)
│  └─ capabilities/                  # scene actions, dashboard widgets
├─ docs/{en,fr,de,es}.md             # user documentation (re-hosted by Gladys)
├─ test/                             # unit tests (`node --test`), fake mailcow API
├─ gladys-assistant-integration.json # manifest
├─ Dockerfile                        # Node 24 Alpine, read-only rootfs ready
├─ CHANGELOG.md · CLAUDE.md · SECURITY.md
├─ .github/workflows/                # ci, release, build, github-release
├─ .github/scripts/changelog-release.mjs
├─ .github/dependabot.yml
└─ cover.png                         # catalog cover, 800×534 px
```

## Run it locally

```bash
npm install
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="mailcow" \
LOG_LEVEL=debug \
npm start
```

The three `GLADYS_*` variables are injected by the Gladys supervisor when the integration runs
inside its container.

## Quality checks

```bash
npm run format:check   # Prettier
npm run lint           # ESLint
npm test               # node --test (no network: fake mailcow API + fake Gladys of the SDK)
npx github:GladysAssistant/integration-store --skip-image-check .   # store checks
```

CI runs them on every push and pull request (Node 22 and 24), builds the Docker image and runs
the store admission checks on pull requests.

## Release

1. Describe the changes under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md).
2. **Actions → Release → Run workflow**, pick `patch`, `minor` or `major`.

The workflow bumps `package.json` and the manifest (`version` + `docker_image`), rolls the
changelog, pushes the `vX.Y.Z` tag, builds the `linux/amd64` + `linux/arm64` image to
`ghcr.io/prohand/gladys-mailcow`, publishes the GitHub Release and runs the full store checks.

Before the first release: add the GitHub topic `gladys-assistant-integration`, make the GHCR
package public, and turn on **Private vulnerability reporting** ([`SECURITY.md`](SECURITY.md)).

## License

Apache-2.0
