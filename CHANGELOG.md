# Changelog

Every notable change to fleet-ops is listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Property-based tests with fast-check and Hypothesis: the timetable across every day of 2026, the signature checks, config validation, the Dependabot policy, stale branch pruning, mirror paths and the backup's merge and watermark.
- Signed releases: the release workflow attaches a source archive, `SHA256SUMS` and a build provenance signed through Sigstore. The runner image gets an attestation in GitHub Container Registry.
- SECURITY.md shows how to verify a release and the image.

## [1.1.3] - 2026-11-27

### Security

- The mirror and backup workflows and the runner image install the package with `-e`, the form Scorecard recognises as installing local code rather than fetching it. Every dependency still comes from the hash locks.

## [1.1.2] - 2026-11-27

### Changed

- A `required-checks` ruleset blocks a merge to `main` until all 13 checks pass. The workflow guide and the testing page describe it and the roadmap drops it.

## [1.1.1] - 2026-11-27

### Security

- Python dependencies install from `requirements.txt` and `requirements-dev.txt`, pinned by hash, in CI, the mirror and backup workflows and the runner image. The package itself installs without fetching anything.
- The runner image's base is pinned by digest. Dependabot now updates it with the rest.

### Fixed

- CodeQL leaves the test folders out, so the tests reading the example config are no longer reported as file data reaching the network.
- The `Session` Protocol method has a docstring body instead of a bare `...`.

## [1.1.0] - 2026-11-27

### Added

- Documentation: a docs index, getting started from an empty account, a reference for every config field and environment variable, the GitHub App's permissions with what each token holds, the slash commands, an operations runbook and a testing guide.
- READMEs for the core and chatops packages. `ROADMAP.md`, `ACCESSIBILITY.md` and `.github/WORKFLOW.md`.
- A documentation issue form. EditorConfig plus `.nvmrc` and `.python-version`.
- `npm run register-commands` registers the `/fleet` command from the same definitions the router uses.
- CI: Biome lint and formatting, mypy in strict mode, coverage thresholds for vitest and pytest, Node 22 and 24, Python 3.12 and 3.13, actionlint with a checksum check and a lychee link check.
- A CodeQL workflow for Actions, TypeScript and Python, replacing the default setup that could not see the Python code.
- Dependency review on pull requests and OpenSSF Scorecard on `main` each week.
- A release workflow that checks every manifest and the changelog against the tag, then pushes the runner image to GitHub Container Registry with provenance and an SBOM.
- A manual deploy workflow in a `production` environment.
- Tests for the governance handlers, the sweep's token choice, the KV store and the shared Python module, bringing the total to 157.

### Changed

- The Python services refuse a config without the owners, mirror and backup sections, with a message naming what is missing.
- The governance sweep and handlers take an injected `fetch`, so they are tested without a network.
- Action pins move to the current releases.

## [1.0.1] - 2026-11-27

### Security

- A failed governance webhook answers with a fixed message and a reference ID. The error detail, which could hold an API response body, goes only to the notify hook under that reference. Found by CodeQL (`js/stack-trace-exposure`).

## [1.0.0] - 2026-11-27

All four systems are in place: the scheduler, governance, the GitLab mirror and the backup.

### Added

- `python/backup`: exports issues, pull requests, issue comments, review comments and releases as JSON. Only what changed since the newest saved item is fetched. Pull requests are read newest first and paging stops at the saved copy.
- A full refresh in the first three days of each month (or with `--full`) so deletions are picked up.
- Sorted, stable JSON, so an unchanged repository writes identical bytes and makes no commit.
- A time budget that starts with the repositories backed up longest ago and defers the rest to the next run.
- `backup.yml`, which commits the export to a private data repository one owner at a time.
- The README diagram, `docs/architecture.md` and four decision records.

### Changed

- The workflows mint tokens with the App's client ID, which replaces the deprecated app ID input.
- The runner image carries the backup as well as the mirror.

## [0.6.0] - 2026-11-27

### Added

- `python/mirror`: mirrors every managed repository to GitLab. LFS objects go first, then branches and tags with `--prune`. GitHub's pull request refs are never pushed.
- A private repository is never published on GitLab. Visibility is set in its own call, apart from the best-effort description and topics.
- The GitHub and GitLab tokens reach git through `GIT_CONFIG_*` variables, never a URL or an argument.
- Transient failures are retried and reported as warnings. Permanent ones fail the run. One repository never stops the rest.
- A storage warning that names the largest projects.
- `mirror.yml` with one job per owner, started by the scheduler. A Dockerfile for the container route.
- CI runs ruff and pytest (with a real git run against local bare repositories) and builds the runner image.

## [0.5.0] - 2026-11-27

### Added

- `workers/governance`: a GitHub App webhook that deletes merged branches and arms auto-merge on Dependabot updates the policy allows.
- The Dependabot policy as pure functions: patch and minor merge, major only for allowed ecosystems, grouped updates judged by their worst line and the author checked so a lookalike branch is refused.
- A daily sweep that reads 25 repositories per GraphQL request, syncs labels without deleting extras and prunes stale branches with no open pull request.
- A read-only settings drift audit. The worker never holds administration write.
- A write budget that keeps one run inside the free plan's 50 subrequests and reports what it deferred.
- The `/fleet` interactions endpoint, wired to the sweep, the audit and the scheduler.

## [0.4.0] - 2026-11-27

### Added

- `workers/scheduler`: a Cloudflare Worker woken every 15 minutes that starts each job in `fleet.json` at its UK wall-clock time all year.
- A job is due at the first tick at or after its time for up to 90 minutes, once per local day. That covers a skipped tick and both clock changes, with tests for each.
- Container jobs go to a signed runner and fall back to `workflow_dispatch` when the runner is missing or refuses.
- Signed `/run` and `/status` routes. Run records are kept in KV for 30 days.
- CI bundles every worker with a wrangler dry run.

## [0.3.0] - 2026-11-27

### Added

- `packages/chatops`: one `/fleet` slash command with help, status, run, audit, sweep, mirror and backup.
- Every Discord request is verified with Ed25519 before its body is read. Anyone outside the owner allowlist in `CHATOPS_OWNER_IDS` is refused before a handler runs.
- Subcommands that change something are deferred and their reply is edited when the work finishes, so a slow job never misses Discord's three second window.
- The registration payload and the help text are built from the same definitions as the router.

## [0.2.0] - 2026-11-27

### Added

- `packages/core`: GitHub webhook, Discord and worker-to-worker signature checks with constant-time compares and a five minute replay window.
- GitHub App JWT signing that accepts a PKCS1 key and installation tokens limited to the permissions and repositories each job needs.
- A REST and GraphQL client that retries brief 502, 503 and 504 errors and reports the operation, repository and status of any failure.
- `fleet.json` validation that lists every problem at once.
- A notify hook that never fails the job it reports on.
- A CI job for the type check and the vitest suite.

## [0.1.0] - 2026-11-27

### Added

- The repository base: licence, community files, issue forms, the pull request template and Dependabot.
- Markdown lint and a gitleaks scan on every pull request.
- An npm workspace root, a shared TypeScript config and a Python project file.
- An example config and an example environment file with placeholders only.

[1.1.3]: https://github.com/zaccesss/fleet-ops/releases/tag/v1.1.3
[1.1.2]: https://github.com/zaccesss/fleet-ops/releases/tag/v1.1.2
[1.1.1]: https://github.com/zaccesss/fleet-ops/releases/tag/v1.1.1
[1.1.0]: https://github.com/zaccesss/fleet-ops/releases/tag/v1.1.0
[1.0.1]: https://github.com/zaccesss/fleet-ops/releases/tag/v1.0.1
[1.0.0]: https://github.com/zaccesss/fleet-ops/releases/tag/v1.0.0
[0.6.0]: https://github.com/zaccesss/fleet-ops/releases/tag/v0.6.0
[0.5.0]: https://github.com/zaccesss/fleet-ops/releases/tag/v0.5.0
[0.4.0]: https://github.com/zaccesss/fleet-ops/releases/tag/v0.4.0
[0.3.0]: https://github.com/zaccesss/fleet-ops/releases/tag/v0.3.0
[0.2.0]: https://github.com/zaccesss/fleet-ops/releases/tag/v0.2.0
[0.1.0]: https://github.com/zaccesss/fleet-ops/releases/tag/v0.1.0
