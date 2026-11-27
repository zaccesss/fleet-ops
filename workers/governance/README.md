# Governance

Keeps every repository in the fleet to the same standard. It is a GitHub App webhook, a daily sweep and the `/fleet` slash command in one worker.

## What it does

| Trigger                                    | Action                                                                                       | Token it asks for                                              |
| ------------------------------------------ | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| A pull request is merged                   | Deletes its branch, unless the branch is in a fork or is the default branch                  | `contents: write` on that one repository                       |
| A Dependabot pull request opens or updates | Arms auto-merge when the policy allows it. GitHub merges only after the required checks pass | `contents` and `pull_requests` write on that one repository    |
| A pull request gets the `automerge` label  | Arms auto-merge the same way                                                                 | The same                                                       |
| The daily cron at 02:20 UTC                | Syncs labels, deletes stale branches and reports settings drift                              | Read for the batched query, then `contents` and `issues` write |
| `/fleet audit`                             | The same report with every write skipped                                                     | Read only                                                      |

## The Dependabot policy

Set in `governance.dependabot` in `fleet.json`.

- Patch and minor updates merge in any ecosystem.
- A major update merges only for an ecosystem in `majorAllowed`, such as `github_actions`, where CI runs the updated action itself.
- A grouped update is judged by its worst line. One line that cannot be read holds the whole group.
- The pull request must be authored by `dependabot[bot]`. A branch named like a Dependabot branch is not enough.

> [!IMPORTANT]
> The drift audit only reports. The worker never asks for `administration: write`, so a bug or a stolen token here cannot turn off branch protection or any other setting.

## Staying inside the free plan

A free Workers invocation may make 50 subrequests. The sweep reads 25 repositories per GraphQL request and spends at most 40 writes per run. Anything over that is counted, reported and picked up the next night.

## Rules it never breaks

- A label the standard does not list is never deleted.
- The default branch, `release/` and `hotfix/` branches are never pruned. Neither is any branch with an open pull request.
- Archived repositories, forks and anything in `exclude` are skipped.
