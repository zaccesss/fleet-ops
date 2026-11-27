# Configuration

Every service reads one file, `config/fleet.json`. The workers get it as the `FLEET_CONFIG` secret, the workflows as the `FLEET_CONFIG` Actions secret. [`config/fleet.example.json`](../config/fleet.example.json) is a complete example.

The workers validate the whole file at start-up and list every problem at once. The Python services check the parts they read.

## Top level

| Field | Type | Meaning |
| --- | --- | --- |
| `owners` | list of names | The accounts and organisations to manage. The first one's repositories keep their names on GitLab. Others are prefixed with the owner |
| `exclude` | list of `owner/name` | Repositories every system leaves alone |

Archived repositories and forks are skipped by governance and the mirror without being listed here.

## `scheduler`

| Field | Type | Meaning |
| --- | --- | --- |
| `timezone` | IANA zone | The zone every `at` time is in, such as `Europe/London` |
| `jobs` | list | The timetable, one entry per job |

Each job:

| Field | Type | Meaning |
| --- | --- | --- |
| `name` | text, unique | Used by `/fleet run`, the run records and notices |
| `repo` | `owner/name` | The repository that holds the job's workflow |
| `workflow` | file name ending `.yml` | The workflow to dispatch |
| `at` | `HH:MM`, 24 hour | Local start time. It must be on the 15 minute grid (`:00`, `:15`, `:30` or `:45`) |
| `days` | `"daily"` or a list such as `["mon", "thu"]` | Which local days it runs |
| `route` | `"containers"` or `"actions"` | Where it runs. `containers` falls back to Actions when the runner is missing or refuses |

> [!NOTE]
> A job is due at the first tick at or after its time for 90 minutes, once per local day. A time inside the hour the clocks skip in March still runs, at the first tick after the gap.

## `governance`

| Field | Type | Meaning |
| --- | --- | --- |
| `staleBranchDays` | whole number | A branch with no open pull request and no commit for this many days is deleted by the nightly sweep |
| `staleIssueDays` | whole number | Validated but not acted on yet. Stale issue handling is on the [roadmap](../ROADMAP.md) |
| `dependabot.autoMerge` | list of `patch`, `minor`, `major` | Which update types merge on their own |
| `dependabot.majorAllowed` | list of ecosystems | Ecosystems whose major updates merge anyway, such as `github_actions` |
| `labels` | list of `{ name, color, description }` | The label standard. Missing labels are created and changed ones corrected. Extra labels are never deleted |
| `settings` | map of setting to `true` or `false` | The settings standard the drift audit reports against |

The drift audit reads these six settings: `allow_squash_merge`, `allow_merge_commit`, `allow_rebase_merge`, `delete_branch_on_merge`, `allow_auto_merge` and `has_wiki`. Other keys are accepted and ignored.

Ecosystem names are the ones Dependabot uses in its branch names, such as `npm_and_yarn`, `pip` and `github_actions`.

## `mirror`

| Field | Type | Meaning |
| --- | --- | --- |
| `gitlabNamespace` | text | The GitLab group the mirrors live in |
| `sizeWarningMiB` | whole number | A warning is sent once the group's storage passes this, naming the three largest projects |

## `backup`

| Field | Type | Meaning |
| --- | --- | --- |
| `timeBudgetMinutes` | whole number | After this long, no new repository is started. The rest go first on the next run |

## Environment variables

### Scheduler worker

| Name | Required | Meaning |
| --- | --- | --- |
| `FLEET_CONFIG` | yes | The config file's contents |
| `RUNS` | yes | The KV namespace binding in `wrangler.toml` |
| `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` | yes | The App, for dispatching workflows |
| `RUN_SECRET` | yes | Shared with governance. At least 32 characters |
| `RUNNER_URL` and `RUNNER_SECRET` | no | The container runner. Without them every job uses Actions |
| `NOTIFY_WEBHOOK_URL` | no | Where failure notices go |

### Governance worker

| Name | Required | Meaning |
| --- | --- | --- |
| `FLEET_CONFIG` | yes | The config file's contents |
| `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` | yes | The App |
| `GITHUB_WEBHOOK_SECRET` | yes | The App's webhook secret. At least 32 characters |
| `DISCORD_PUBLIC_KEY` and `DISCORD_APPLICATION_ID` | for `/fleet` | The Discord application |
| `CHATOPS_OWNER_IDS` | for `/fleet` | Comma separated Discord user IDs allowed to run commands |
| `SCHEDULER_URL` and `RUN_SECRET` | for `run`, `status`, `mirror` and `backup` | The scheduler and the shared secret |
| `NOTIFY_WEBHOOK_URL` | no | Where failure notices go |

### Mirror and backup

| Name | Used by | Meaning |
| --- | --- | --- |
| `FLEET_CONFIG` | both | The config file's contents, unless `--config` gives a path |
| `GITHUB_TOKEN` | both | An installation token for the owner being processed |
| `GITLAB_TOKEN` | mirror | A GitLab token with `api` and `write_repository` |
| `GITLAB_URL` | mirror | Defaults to `https://gitlab.com` |
| `NOTIFY_WEBHOOK_URL` | both | Optional |

### Command registration

`npm run register-commands` reads `DISCORD_APPLICATION_ID` and `DISCORD_BOT_TOKEN`.

## The notice format

Every service posts the same JSON to `NOTIFY_WEBHOOK_URL`. Anything that accepts a JSON POST can receive it.

```json
{
  "job": "mirror",
  "level": "warn",
  "summary": "mirrored 41, created 0, empty 1, transient 1, failed 0",
  "details": ["example-user/site: push to https://gitlab.com/example-group/site.git failed transiently"],
  "at": "2026-11-27T23:04:12.000Z"
}
```

`level` is `ok`, `warn` or `fail`. `details` holds at most 25 lines.
