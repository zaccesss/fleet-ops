# 2. One cron trigger and a timetable, not one trigger per job

## Context

A Cloudflare account on the free plan has a small, fixed number of cron triggers. Cron expressions are also in UTC, so a job meant for 23:00 in the UK would run at 23:00 or 00:00 depending on the time of year. GitHub's own `schedule:` trigger has the same problem and is often late under load.

## Decision

The scheduler has one trigger, every 15 minutes. The timetable lives in `fleet.json` in local time. Each tick works out the local time with `Intl` and starts any job whose time has passed within the last 90 minutes and that has not run that local day.

## Consequences

- Adding a job never needs a new trigger.
- Clock changes need no special case. The 90 minute window covers the hour March skips. The once-per-day record covers the hour October repeats.
- A job time must sit on the 15 minute grid. The scheduler refuses a timetable with a time that never lines up.
