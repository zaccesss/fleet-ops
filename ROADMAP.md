# Roadmap

What comes next, kept apart from what is deliberately left out.

## Next

- **A container runner front.** The scheduler already signs its call to `RUNNER_URL` and the image is published to GHCR, but the repository does not ship the service that receives the call and starts the image. A small Cloudflare Containers worker would close that gap. Until then every `containers` job falls back to Actions.
- **Stale issues.** `governance.staleIssueDays` is validated but nothing acts on it. The sweep should label an issue with no activity for that long and close it after a second period, inside the same write budget.
- **A restore command for the backup.** Turning the JSON back into issues and comments on a new repository, with the original authors and dates quoted in the body.
- **Stale run records in `/fleet status`.** Showing how long ago each job last ran and flagging one that missed its day.

## Later

- Organisation-wide settings beyond the six the drift audit reads, such as default branch protection.
- A dry run for the mirror that lists what would be pushed.

## Left out on purpose

- **Forges other than GitLab.** One mirror is enough for a second home. More forges would multiply the failure modes without adding much.
- **Automatic fixes for drift.** The audit only reports. Fixing settings needs administration write, which no worker holds.
