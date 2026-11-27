# 3. Fewer jobs per workflow run

## Context

GitHub Actions bills each job in a private repository rounded up to the next whole minute. A run of five ten-second jobs costs five minutes, while one job doing the same work costs one.

## Decision

Checks that can share a runner share a job. The mirror and the backup run one job per owner because an App installation token covers one account. They never run one job per repository. Workflows run on pull requests only, since the `main` ruleset only accepts changes through a pull request that was already checked.

## Consequences

- The minutes a run uses track the work done, not the number of steps.
- Splitting a job is a deliberate choice, made only when it buys isolation, such as a separate token per owner.
