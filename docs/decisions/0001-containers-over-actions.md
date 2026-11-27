# 1. Run scheduled work on Containers, with Actions as the fallback

## Context

The nightly mirror and the daily backup are the heaviest jobs. On GitHub Actions a private repository pays for every minute and every job is rounded up to at least one minute. A sweep split across several jobs pays that minimum several times.

## Decision

The scheduler sends these jobs to a container runner on Cloudflare, which bills by the second. Each job keeps its GitHub Actions workflow. When the runner is not configured, refuses the call or cannot be reached, the scheduler dispatches the workflow instead.

## Consequences

- The jobs cost far less on a quiet night, when there is little to mirror.
- A runner outage delays nothing, because the fallback starts the same entry point on Actions.
- Both routes run the same command from the same image definition, so they cannot drift apart.
