# Scheduler

Starts every job in `fleet.json` at its local time, all year.

## How a tick works

1. A cron trigger wakes the worker every 15 minutes in UTC.
2. The tick turns that moment into local wall-clock time with `Intl`, using `scheduler.timezone`.
3. A job is due at the first tick at or after its time, for up to 90 minutes, unless it already ran that local day. Jobs outside that window are skipped before any storage is read.
4. A due job starts on its route. `containers` sends a signed call to the runner and falls back to a `workflow_dispatch` if the runner is missing or refuses. `actions` dispatches straight away with a token that can only start workflows in that one repository.
5. The result is saved in KV. A failed start is not counted as the day's run, so the next tick in the window tries again.
6. Failures from the whole tick go out in one notice.

> [!NOTE]
> The 90 minute window is what makes the clock changes safe. In March a 01:00 job is first seen at 02:00 local, a full hour late. It still runs. In October the repeated hour finds the job already done.

## Routes

| Route     | Method | What it does                                                             |
| --------- | ------ | ------------------------------------------------------------------------ |
| `/run`    | POST   | Starts one job now from `{"job": "<name>"}`. It counts as that day's run |
| `/status` | GET    | The last run of every job                                                |

Both need the `X-Run-Timestamp` and `X-Run-Signature` headers from `signedRunHeaders` in `packages/core`.

## Setup

```sh
wrangler kv namespace create RUNS
wrangler secret put GITHUB_APP_ID
wrangler secret put GITHUB_APP_PRIVATE_KEY
wrangler secret put RUN_SECRET
wrangler secret put FLEET_CONFIG < ../../config/fleet.json
wrangler deploy
```

The runner settings (`RUNNER_URL` with `RUNNER_SECRET`) are optional. So is `NOTIFY_WEBHOOK_URL`.
