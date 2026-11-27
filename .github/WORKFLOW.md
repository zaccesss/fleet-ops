# Workflow

How a change reaches `main` and how a release goes out.

## A change

1. Open an issue with one of the forms, so the reason is written down before the code.
2. Branch from an up-to-date `main`: `fix/<short-description>` or `feat/<short-description>`.
3. Make the change with its tests. Run the checks below before pushing.
4. Open a pull request with the template and `Closes #<issue>`.
5. CI, CodeQL, gitleaks, markdown lint and dependency review run on the pull request. Every one must pass.
6. It is reviewed, then squash-merged. The branch is deleted on merge.

Two rulesets guard `main`. `protect-main` only accepts changes through a pull request and refuses force pushes and deletion. `required-checks` blocks a merge until all 13 checks pass: Lint, TypeScript on Node 22 and 24, Python 3.12 and 3.13, the container image, the link check, Gitleaks, markdown lint, dependency review and the three CodeQL analyses.

## Checks before pushing

```sh
npm run lint && npm run typecheck && npm run coverage
cd python && ruff check . && ruff format --check . && mypy && python -m pytest
```

## Commits

- Conventional prefixes: `feat`, `fix`, `chore`, `ci`, `docs`.
- An imperative subject of 72 characters or fewer, with no issue number. The squash merge adds the pull request number.
- Code comments explain why, not what.

## A release

1. Bump the version in every `package.json` and in `python/pyproject.toml`.
2. Add a dated section to `CHANGELOG.md` and its link at the end.
3. Merge that with the change it describes.
4. Create the tag, for example with `gh release create v1.2.3`. The release workflow checks that every version and the changelog match the tag. It creates the release from the changelog section if it does not exist yet. Then it publishes the runner image to `ghcr.io/zaccesss/fleet-ops-runner`.

## Deploying

The **Deploy** workflow is started by hand from the Actions tab and runs in the `production` environment. It checks the code again, then deploys the scheduler, governance or both. Secrets live in that environment only.

## Dependencies

Dependabot opens grouped pull requests each Sunday for npm, pip and GitHub Actions. Major versions are left for a person to pick up, since they are the ones that change behaviour.
