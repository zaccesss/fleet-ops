# Workflows

Every workflow runs on pull requests only. The `main` ruleset only accepts changes through a pull request, so running again on the push to `main` would check the same commit twice.

| Workflow | What it checks |
| --- | --- |
| [markdownlint.yml](markdownlint.yml) | Every markdown file against [.markdownlint.json](../../.markdownlint.json) |
| [gitleaks.yml](gitleaks.yml) | The tree for hard-coded secrets, with findings redacted from the log |

Third-party actions are pinned to a full commit SHA, with the version in a comment, so a moved tag cannot change what runs. Dependabot keeps the pins current.
