# Workflows

The checks run on pull requests only. The `main` ruleset only accepts changes through a pull request, so running them again on the push to `main` would check the same commit twice. The two jobs have no schedule of their own: the scheduler starts them with `workflow_dispatch` at their UK time.

## Checks

| Workflow | What it checks |
| --- | --- |
| [ci.yml](ci.yml) | The TypeScript type check, the vitest suite and a dry-run bundle of every worker. Ruff and pytest for the Python services. A build of the runner image with a smoke test |
| [markdownlint.yml](markdownlint.yml) | Every markdown file against [.markdownlint.json](../../.markdownlint.json) |
| [gitleaks.yml](gitleaks.yml) | The tree for hard-coded secrets, with findings redacted from the log |

## Jobs

| Workflow | What it does | Secrets and variables |
| --- | --- | --- |
| [mirror.yml](mirror.yml) | Mirrors every repository to GitLab, one job per owner | `FLEET_CONFIG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITLAB_TOKEN`, optional `GITLAB_URL` |
| [backup.yml](backup.yml) | Backs up issues, pull requests and releases into a private data repository, one owner at a time | `FLEET_CONFIG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_PRIVATE_KEY`, `BACKUP_OWNER`, `BACKUP_REPO` |

Both mint short-lived App tokens per owner with only the permissions they read or write. Inputs reach the shell as environment variables, never pasted into a script.

Third-party actions are pinned to a full commit SHA, with the version in a comment, so a moved tag cannot change what runs. Dependabot keeps the pins current.
