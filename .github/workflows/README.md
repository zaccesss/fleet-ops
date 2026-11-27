# Workflows

The checks run on pull requests. The `main` ruleset only accepts changes through a pull request, so running them again on the push to `main` would check the same commit twice. CodeQL and Scorecard also run on `main` and each week, since new queries can find problems in code that has not changed.

## Checks on every pull request

| Workflow | Job | What it checks |
| --- | --- | --- |
| [ci.yml](ci.yml) | Lint | Biome lint and formatting for TypeScript. actionlint for every workflow, downloaded with its published checksum |
| | TypeScript (Node 22 and 24) | The type check, vitest with coverage thresholds and a dry-run bundle of each worker |
| | Python (3.12 and 3.13) | Ruff lint and formatting, mypy in strict mode and pytest with a coverage threshold, including a real git run |
| | Container image | Builds the runner image and starts both entry points |
| | Links | Every link in every markdown file, with lychee |
| [codeql.yml](codeql.yml) | Analyse | CodeQL's security and quality queries for Actions, TypeScript and Python |
| [dependency-review.yml](dependency-review.yml) | Dependency review | Refuses a new dependency with a known vulnerability of moderate severity or worse. A GPL or AGPL licence is refused too |
| [gitleaks.yml](gitleaks.yml) | Gitleaks | The tree for hard-coded secrets, with findings redacted from the log |
| [markdownlint.yml](markdownlint.yml) | Markdown lint | Every markdown file against [.markdownlint.json](../../.markdownlint.json) |

## On `main` and on a schedule

| Workflow | When | What it does |
| --- | --- | --- |
| [codeql.yml](codeql.yml) | Push to `main`, Mondays 04:17 UTC | The same analysis on the merged code |
| [scorecard.yml](scorecard.yml) | Push to `main`, Mondays 05:41 UTC | OpenSSF Scorecard. Results go to code scanning and the README badge |

## Releases and deploys

| Workflow | Trigger | What it does |
| --- | --- | --- |
| [release.yml](release.yml) | A `v*.*.*` tag | Checks every manifest and the changelog against the tag, creates the release from its changelog section if it is missing, then attaches a source archive, `SHA256SUMS` and a Sigstore-signed provenance. It pushes the runner image to `ghcr.io/zaccesss/fleet-ops-runner` with provenance, an SBOM and an attestation |
| [deploy.yml](deploy.yml) | By hand | Checks the code, then deploys the scheduler, governance or both, in the `production` environment |

## Jobs the scheduler starts

These have no schedule of their own. The scheduler starts them with `workflow_dispatch` at their UK time.

| Workflow | What it does | Secrets and variables |
| --- | --- | --- |
| [mirror.yml](mirror.yml) | Mirrors every repository to GitLab, one job per owner | `FLEET_CONFIG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITLAB_TOKEN`, optional `GITLAB_URL` |
| [backup.yml](backup.yml) | Backs up issues, pull requests and releases into a private data repository, one owner at a time | `FLEET_CONFIG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_PRIVATE_KEY`, `BACKUP_OWNER`, `BACKUP_REPO` |

Both mint short-lived App tokens per owner with only the permissions they read or write. Inputs reach the shell as environment variables, never pasted into a script.

## Conventions

- Every third-party action is pinned to a full commit SHA, with the version in a comment, so a moved tag cannot change what runs. Dependabot keeps the pins current.
- Every workflow starts with `contents: read` and a job asks for more only where it needs it.
- Every job has a timeout.
