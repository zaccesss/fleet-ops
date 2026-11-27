# Contributing

Bug reports and suggestions are welcome. The licence does not allow changed copies to be shared, so a pull request is best kept small and discussed in an issue first.

## What belongs here

- Bug fixes, above all anything that could merge, delete or push the wrong thing
- Tests for edge cases that are not covered yet
- Clearer errors, logs and docs

## What does not belong here

- Anything that weakens a signature check, the owner allowlist or the read-only drift audit
- Support for more forges than GitLab
- Secrets, real account names or real IDs in code, tests or config

## Building and testing

```sh
npm ci
npm run lint && npm run typecheck && npm run coverage
cd python && pip install -e ".[dev]" && ruff check . && ruff format --check . && mypy && python -m pytest
```

`npm run format` fixes TypeScript formatting and `ruff format .` fixes Python. CI runs the same checks on every pull request plus the rest listed in [the workflows README](.github/workflows/README.md). Tests never call a real API: [testing](docs/testing.md) explains the fakes. A change that lowers coverage below the thresholds fails.

## How to contribute

1. Open an issue with the bug report or feature request form.
2. Create a branch named `fix/<short-description>` or `feat/<short-description>`.
3. Make the change with tests and run the checks above.
4. Add a line under `Unreleased` in [CHANGELOG.md](CHANGELOG.md) for anything a user would notice.
5. Open a pull request with the template and describe what changed and why. [The workflow](.github/WORKFLOW.md) covers the rest, releases included.

Code comments explain why something is done, not what the line does.

## Using AI

Every pull request declares whether AI was used, following the [AI policy](https://github.com/zaccesss/ai-policy) (also on [isaacadjei.me/ai-policy](https://isaacadjei.me/ai-policy)). The pull request template asks for it.

## The shared guide

> [!NOTE]
> One shared contributing guide covers every project here: [zaccesss/contribute](https://github.com/zaccesss/contribute), also on [isaacadjei.me/contribute](https://isaacadjei.me/contribute). This file takes precedence where the two differ.
