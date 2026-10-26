# Changelog

All notable changes to this integration are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/), bumped by the Release workflow.

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- First version of the mailcow integration, started from the official Gladys
  JavaScript template.
- A **mailcow server** device: containers running and down, mail queue,
  quarantine, banned IPs, mail storage (GB and %), domains, mailboxes and the
  mailcow version.
- One device per **domain** (on by default) and per **mailbox** (off by default,
  200 at most), with an "active" switch Gladys can flip when changes are
  allowed.
- **Local and cloud transports**: a LAN address, a public address, or both.
  The "Prefer the local connection" switch picks the one tried first; the badge
  of every device says which one answered, degraded when it is the fallback.
- **Scene triggers**: a container stopped / running again, mail queue too long,
  mail storage almost full, mailbox almost full, a mail quarantined, an IP
  banned, server unreachable / reachable again.
- **Scene actions**: read the server now (with its counters as outputs), flush
  the mail queue, turn a mailbox on or off.
- **Dashboard widgets**: server status, quarantine, mailboxes closest to their
  quota.
- **Test the connection** and **Flush the mail queue** buttons in the
  configuration.
- Every text in English, French, German and Spanish, with the user
  documentation in `docs/`.
- `SECURITY.md`, `CLAUDE.md`, CI (Node 22 and 24, Docker build, store
  checks), Release and GitHub releases workflows, Dependabot.

### Security

- Read-only by default: nothing in Gladys can change mailcow until "Allow
  changes" is ticked, with a read-write API key.
- The certificate of the public address is always checked; only the LAN
  address can skip the check. The API key is never logged.

[Unreleased]: https://github.com/prohand/gladys-mailcow/commits/main
