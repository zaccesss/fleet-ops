# The GitHub App

Every system acts as one GitHub App. It is granted the permissions below, but no job ever holds all of them at once. Each job mints a token that lasts an hour with only the permissions it uses. A webhook job's token also covers only the one repository the event came from.

## Repository permissions

| Permission | Access | Used by | For |
| --- | --- | --- | --- |
| Metadata | Read | Everything | Required by GitHub for any App |
| Contents | Read and write | Governance, mirror, backup | Deleting merged and stale branches, the mirror's clone, the backup's commit to its data repository |
| Pull requests | Read and write | Governance, backup | Arming auto-merge, reading pull requests for the backup |
| Issues | Read and write | Governance, backup | Syncing labels, reading issues for the backup |
| Administration | Read | Governance | The drift audit reads repository settings |
| Actions | Read and write | Scheduler | Starting workflows with `workflow_dispatch` |

> [!IMPORTANT]
> Administration is read only on purpose. A token with administration write could turn off branch protection, so the drift audit can report a wrong setting but never change one.

## Events

| Event | Handled by | What happens |
| --- | --- | --- |
| Pull request | Governance `/webhook` | A merged pull request's branch is deleted. Auto-merge is armed on a Dependabot update the policy allows and on any pull request with the `automerge` label |

Every other event is answered with "event not handled".

## What each token holds

| Job | Permissions | Repositories |
| --- | --- | --- |
| Delete a merged branch | `contents: write` | The one repository |
| Arm auto-merge | `contents: write`, `pull_requests: write` | The one repository |
| Nightly read of the fleet | `metadata`, `administration`, `contents` and `pull_requests`, all read | The installation |
| Nightly label sync and branch pruning | `contents: write`, `issues: write` | The installation |
| `/fleet audit` | Read only. No write token is minted | The installation |
| Dispatch a workflow | `actions: write`, `metadata: read` | The job's repository |
| Mirror and backup | Read access to contents, issues and pull requests | The owner's installation |
| Backup commit | `contents: write` | The data repository only |

## Auto-merge needs the setting

GitHub only arms auto-merge on a repository with **Allow auto-merge** turned on. The settings standard in `fleet.json` includes `allow_auto_merge`, so the drift audit reports any repository where it is off.
