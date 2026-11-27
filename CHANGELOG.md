# Changelog

Every notable change to fleet-ops is listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

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

[0.5.0]: https://github.com/zaccesss/fleet-ops/releases/tag/v0.5.0
[0.4.0]: https://github.com/zaccesss/fleet-ops/releases/tag/v0.4.0
[0.3.0]: https://github.com/zaccesss/fleet-ops/releases/tag/v0.3.0
[0.2.0]: https://github.com/zaccesss/fleet-ops/releases/tag/v0.2.0
[0.1.0]: https://github.com/zaccesss/fleet-ops/releases/tag/v0.1.0
