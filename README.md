# fleet-ops

Automation for running a fleet of GitHub repositories: a scheduler that keeps jobs on UK time, governance that keeps every repository tidy, mirroring to GitLab and a backup of issues, pull requests and releases.

[![Markdown Lint](https://github.com/zaccesss/fleet-ops/actions/workflows/markdownlint.yml/badge.svg)](https://github.com/zaccesss/fleet-ops/actions/workflows/markdownlint.yml)
[![Gitleaks](https://github.com/zaccesss/fleet-ops/actions/workflows/gitleaks.yml/badge.svg)](https://github.com/zaccesss/fleet-ops/actions/workflows/gitleaks.yml)
[![Licence](https://img.shields.io/badge/licence-PolyForm%20Strict%201.0.0-blue.svg)](LICENSE)

> [!NOTE]
> The services are being added one at a time. The [changelog](CHANGELOG.md) lists what is in place so far.

## The four systems

| System | Folder | What it does |
| --- | --- | --- |
| Scheduler | `workers/scheduler` | Starts every job at its real UK time, across clock changes |
| Governance | `workers/governance` | Cleans up branches, merges safe dependency updates, syncs labels and audits settings |
| Mirror | `python/mirror` | Copies every repository to GitLab |
| Backup | `python/backup` | Saves issues, pull requests, comments and releases as JSON |

Two shared packages sit underneath: `packages/core` (GitHub App auth, webhook checks and config) and `packages/chatops` (slash commands in Discord).

## Licence

[PolyForm Strict 1.0.0](LICENSE). The code can be read and used for personal, noncommercial purposes. It cannot be changed or redistributed.
