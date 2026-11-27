# Changelog

Every notable change to fleet-ops is listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

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

[0.2.0]: https://github.com/zaccesss/fleet-ops/releases/tag/v0.2.0
[0.1.0]: https://github.com/zaccesss/fleet-ops/releases/tag/v0.1.0
