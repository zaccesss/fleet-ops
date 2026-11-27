# Commands

One slash command, `/fleet`, with seven subcommands. Only users listed in `CHATOPS_OWNER_IDS` can run them. Everyone else gets a refusal and nothing runs. Replies are only visible to the person who ran the command.

| Subcommand | Options | What it does | Changes anything |
| --- | --- | --- | --- |
| `/fleet help` | none | Lists the subcommands | No |
| `/fleet status` | none | The last run of every scheduled job, from the scheduler | No |
| `/fleet run` | `job` (required) | Starts one job from the timetable now. It counts as that day's run | Yes |
| `/fleet audit` | `repos`, `except` | Reports settings drift. Every write is skipped | No |
| `/fleet sweep` | `repos`, `except` | Runs the nightly sweep now: label sync, stale branch pruning and the drift report | Yes |
| `/fleet mirror` | `repos`, `except` | Starts the `mirror-sweep` job | Yes |
| `/fleet backup` | `repos`, `except` | Starts the `backup` job | Yes |

## Choosing repositories

- An empty `repos` means every managed repository. So does `all`.
- List names with commas: `repos:site,docs`. A name works on its own or as `owner/name`.
- `except` leaves names out: `repos:all except:archive-site`.

## Quick and slow commands

A command that only reads answers straight away. A command that changes something replies with Discord's "thinking" message first, does the work, then replaces the message with the result. That keeps a slow sweep inside Discord's three second limit for a first reply.

Every reply is cut to Discord's 2,000 character limit.

## When a command fails

The reply starts with `Failed:` and says which call failed, on which repository, with the HTTP status. [Operations](operations.md) explains the common ones.
