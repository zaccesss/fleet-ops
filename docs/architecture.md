# Architecture

fleet-ops is two Cloudflare Workers, two Python services and two shared TypeScript packages. They act on GitHub as one GitHub App.

## The parts

| Part | Runs on | Woken by | Talks to |
| --- | --- | --- | --- |
| Scheduler | Cloudflare Workers with KV | A cron trigger every 15 minutes, plus signed calls | The container runner, GitHub Actions |
| Governance | Cloudflare Workers | GitHub App webhooks, a daily cron, Discord | GitHub's REST and GraphQL APIs, the scheduler |
| Mirror | A container or GitHub Actions | The scheduler | GitHub, GitLab |
| Backup | GitHub Actions | The scheduler | GitHub, a private data repository |

## A scheduled job, end to end

1. The scheduler's cron fires. The tick turns the UTC moment into UK wall-clock time.
2. For each job inside its window, it reads the job's last run from KV. A job that already ran this local day is skipped.
3. A `containers` job is sent to the runner as a signed call. If the runner is missing or refuses, the job falls back to a `workflow_dispatch` on GitHub Actions.
4. The result is saved. A failed start is not counted, so the next tick retries it.
5. The mirror or backup works through one repository at a time. It posts a notice if anything failed.

## A pull request event, end to end

1. GitHub sends the event to governance's `/webhook` route. The HMAC is checked against the raw body before anything is parsed.
2. A merged pull request has its branch deleted, unless the branch lives in a fork or is the default branch.
3. A Dependabot pull request is judged by the policy in `fleet.json`. When it passes, auto-merge is armed through GraphQL. GitHub merges only after the required checks pass.
4. Each action gets its own token for that one repository with only the permissions it uses.

## A slash command, end to end

1. Discord posts the interaction to governance's `/interactions` route. The Ed25519 signature is checked first.
2. The caller's user ID must be in `CHATOPS_OWNER_IDS`. Anyone else is refused before a handler runs.
3. A read-only command such as `audit` answers straight away. A command that changes something replies "thinking", does the work, then edits the reply.
4. The run, mirror and backup commands reach the scheduler with a signed call, so starting a job by hand also counts as that day's run.

## Trust boundaries

| Boundary | Check |
| --- | --- |
| GitHub to governance | HMAC SHA-256 of the raw body with the webhook secret |
| Discord to governance | Ed25519 with the application's public key, then the owner allowlist |
| Worker to worker | HMAC of the timestamp and body. More than five minutes of clock difference is refused |
| fleet-ops to GitHub | App installation tokens, per job, limited to the permissions and repositories needed |
| fleet-ops to GitLab | A token passed to git through `GIT_CONFIG_*` variables, never in a URL or an argument |

> [!NOTE]
> Every comparison of a signature runs in constant time, so the time taken says nothing about how close a guess was.
