# Testing

## Running the tests

```sh
npm run lint        # Biome lint and formatting
npm run typecheck   # tsc over every package and worker
npm run coverage    # vitest with the coverage thresholds
cd python
ruff check . && ruff format --check .
mypy
python -m pytest
```

## No real APIs

No test talks to GitHub, GitLab, Discord or Cloudflare.

- **TypeScript** uses `fakeFetch` from `@fleet-ops/core/testing`. Each route matches a method and a URL pattern and gives a status and a body. Every call is recorded, so a test can check exactly what was sent, including headers. A request no route matches fails the test instead of reaching the network.
- **Python** uses `FakeSession` and `FakeRunner` from `python/tests/conftest.py`. The session answers HTTP calls the same way. The runner stands in for git and records every command with its environment.
- Every network client takes its `fetch` or session as an argument for this reason. Nothing reaches for a global client the test cannot replace.

## Things worth knowing

| Test | Why it exists |
| --- | --- |
| `workers/scheduler/test/plan.test.ts` | Walks real 15 minute tick sequences through both 2026 clock changes, a skipped tick and an outage longer than the window |
| `packages/core/test/signatures.test.ts` | Checks the HMAC against the RFC 4231 vector and the replay window at both edges |
| `packages/core/test/app.test.ts` | Signs a JWT with a freshly generated RSA key and verifies it with the public half |
| `packages/chatops/test/interactions.test.ts` | Signs requests with a generated Ed25519 key, including a tampered body and a user outside the allowlist |
| `workers/governance/test/handle-webhook.test.ts` | Proves an error's detail never reaches the webhook response |
| `python/tests/test_git_real.py` | The one place a fake is not enough: the real git binary mirrors between local bare repositories, proving `refs/pull/*` never arrives and a deleted branch is pruned. It ignores the machine's own git config |

## Coverage

Both suites fail when coverage drops below their thresholds, set just under the current figures.

| Suite | Thresholds | Where |
| --- | --- | --- |
| TypeScript | 85% statements, 78% branches, 80% functions, 88% lines | `vitest.config.mts` |
| Python | 88% of lines and branches | `python/pyproject.toml` |

The worker entry points are mostly wiring and are covered through the functions they call.

## What CI runs

On every pull request: Biome, actionlint, the type check and tests on Node 22 and 24, a dry-run bundle of each worker, ruff, mypy and pytest on Python 3.12 and 3.13, a build of the runner image, a link check, gitleaks, markdown lint, dependency review and CodeQL. The full list is in [the workflows README](../.github/workflows/README.md).
