# 4. Batched reads and a write budget

## Context

A free Workers invocation may make 50 subrequests. A sweep that read each repository with a few REST calls would pass that limit at around a dozen repositories.

## Decision

The sweep reads 25 repositories per GraphQL request, with their settings, labels and branches in one query. Writes cannot be batched, so each one is spent from a budget of 40 per run, leaving room for the reads. When the budget runs out, the rest of the writes wait for the next run and the report says how many were deferred.

## Consequences

- A fleet of 100 repositories reads in 4 requests.
- A large drift, such as a new label standard, is applied over several nights instead of failing in one.
- A two-step action is only started when both steps fit, so nothing is left half done.
