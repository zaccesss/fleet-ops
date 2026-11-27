# fleet-ops

Automation for running a fleet of GitHub repositories: a scheduler that keeps jobs on UK time, governance that keeps every repository tidy, mirroring to GitLab and a backup of issues, pull requests and releases.

[![CI](https://github.com/zaccesss/fleet-ops/actions/workflows/ci.yml/badge.svg)](https://github.com/zaccesss/fleet-ops/actions/workflows/ci.yml)
[![Markdown Lint](https://github.com/zaccesss/fleet-ops/actions/workflows/markdownlint.yml/badge.svg)](https://github.com/zaccesss/fleet-ops/actions/workflows/markdownlint.yml)
[![Gitleaks](https://github.com/zaccesss/fleet-ops/actions/workflows/gitleaks.yml/badge.svg)](https://github.com/zaccesss/fleet-ops/actions/workflows/gitleaks.yml)
[![Release](https://img.shields.io/badge/release-v1.0.1-blue.svg)](https://github.com/zaccesss/fleet-ops/releases/latest)
[![Licence](https://img.shields.io/badge/licence-PolyForm%20Strict%201.0.0-blue.svg)](LICENSE)

## The four systems

| System | Folder | What it does |
| --- | --- | --- |
| Scheduler | [`workers/scheduler`](workers/scheduler) | Starts every job at its real UK time, across clock changes and missed ticks |
| Governance | [`workers/governance`](workers/governance) | Deletes merged branches, merges safe Dependabot updates, syncs labels, prunes stale branches and reports settings drift |
| Mirror | [`python/mirror`](python/mirror) | Copies every repository to GitLab, keeping private ones private |
| Backup | [`python/backup`](python/backup) | Saves issues, pull requests, comments, reviews and releases as JSON |

Two shared packages sit underneath: [`packages/core`](packages/core) (GitHub App auth, signature checks, the API client and config) and [`packages/chatops`](packages/chatops) (the `/fleet` slash command in Discord).

## How it fits together

```mermaid
flowchart LR
    tick["Cloudflare cron, every 15 minutes"] --> scheduler["Scheduler worker"]
    scheduler -- "signed call" --> runner["Container runner"]
    scheduler -- "workflow_dispatch" --> actions["GitHub Actions"]
    runner --> mirror["Mirror"]
    actions --> mirror
    actions --> backup["Backup"]
    mirror --> gitlab[("GitLab")]
    backup --> data[("Private data repository")]
    webhooks["GitHub App webhooks"] --> governance["Governance worker"]
    daily["Daily cron"] --> governance
    chat["/fleet in Discord"] --> governance
    governance -- "signed call" --> scheduler
    governance --> repos[("GitHub repositories")]
```

[docs/architecture.md](docs/architecture.md) walks through each path. [docs/decisions](docs/decisions) explains the trade-offs behind it.

## Design choices

- **Least privilege.** Every job mints its own GitHub App token, valid for an hour, with only the permissions it needs and, for a webhook, only the one repository. Governance never holds administration write, so its drift audit can only report.
- **Nothing trusted unverified.** GitHub webhooks are checked by HMAC, Discord requests by Ed25519 and calls between workers by a timestamped HMAC that refuses anything more than five minutes old.
- **Free-tier limits as design inputs.** One sweep stays inside the 50 subrequests a free Workers invocation allows. Scheduled work runs on Containers, which bill by the second, with GitHub Actions as the fallback.
- **Failures are contained.** One repository or job failing never stops the rest. Transient errors are retried and reported as warnings. Only permanent ones fail a run.
- **Secrets stay out of sight.** Tokens never appear in a URL, a command line or a log. Every value lives in a secret store, with placeholders in [`.env.example`](.env.example).

## Tests

135 tests run on every pull request: 99 in TypeScript with vitest and 36 in Python with pytest. Every network call goes through a fake. CI also runs the real git binary against local bare repositories, bundles each worker with a wrangler dry run and builds the runner image.

```sh
npm ci
npm run typecheck
npm test
cd python && pip install -e ".[dev]" && ruff check . && pytest
```

## Configuration

Every service reads one file, [`config/fleet.example.json`](config/fleet.example.json) copied to `config/fleet.json`. It holds the owners, the timetable, the Dependabot policy, the label standard, the settings standard and the GitLab namespace. It is validated at start-up and every problem is listed at once.

## Licence

[PolyForm Strict 1.0.0](LICENSE). The code can be read and used for personal, noncommercial purposes. It cannot be changed or redistributed.
