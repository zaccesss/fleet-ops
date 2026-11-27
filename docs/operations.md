# Operations

How to tell what went wrong and what to do about it.

## Where failures show up

| Source | Where to look |
| --- | --- |
| Any system | A notice posted to `NOTIFY_WEBHOOK_URL` ([format](configuration.md#the-notice-format)) |
| Workers | The Cloudflare Workers page for the worker, under **Logs**. Observability is on in both `wrangler.toml` files |
| Mirror and backup | The repository's Actions tab, the job summary printed at the end of each run |
| Webhooks | The GitHub App's **Advanced** tab lists every delivery with its response |
| Slash commands | The reply itself starts with `Failed:` |

## Common failures

| Message | Cause | Fix |
| --- | --- | --- |
| `the App is not installed on this account` | An owner in `fleet.json` has no installation | Install the App on that account |
| `mint token ... 422` | The token asked for a permission the App was not granted | Compare the App with [GitHub App](github-app.md) and accept any pending permission request on each installation |
| `enable auto-merge ... 200 [...]` | The repository does not allow auto-merge | Turn on **Allow auto-merge**. The drift audit flags it as `allow_auto_merge` |
| `delete branch ... 403` | The branch is protected | Nothing to do. Protected branches are meant to stay |
| `read namespace ... HTTP 404` | `mirror.gitlabNamespace` is wrong or the token cannot see it | Check the group path and the token's scopes |
| `push to ... failed transiently` | The network or GitLab was briefly down | Nothing to do. The next run retries |
| `push to ... failed: ... protected branch hook declined` | A GitLab protection was added by hand | Remove it. The mirror removes protection on each run, so this means a protection it could not remove |
| `GET ... HTTP 401, the token cannot read this` | The backup's token expired or lacks issues or pull request read | Check the installation's permissions |
| `fleet.json has N problem(s)` | An invalid config | Each problem is listed. Fix them all and redeploy |
| `invalid signature` with a 401 | A request was not signed with the expected secret | Check the secret on both sides. A clock more than five minutes out also fails a signed call |
| `N write(s) deferred to the next run` | The nightly sweep hit its 40 write budget | Nothing to do. The rest are applied over the next nights |

## Running something by hand

| To | Do |
| --- | --- |
| Start a scheduled job now | `/fleet run job:<name>`. A signed POST to the scheduler's `/run` does the same |
| Mirror a few repositories | Run `mirror.yml` from the Actions tab with `repos` filled in |
| Back up everything again | Run `backup.yml` with `full` ticked |
| Retry a webhook | The App's **Advanced** tab, open the delivery, **Redeliver**. A failed delivery answers 500, so GitHub marks it for this |
| Check drift without changing anything | `/fleet audit` |

## Pausing a job

Remove it from `scheduler.jobs`, update the `FLEET_CONFIG` secret and redeploy the scheduler. Its run records expire from KV after 30 days.

## Rotating secrets

| Secret | Steps |
| --- | --- |
| App private key | Generate a new key on the App page, update `GITHUB_APP_PRIVATE_KEY` in both workers and the Actions secrets, then delete the old key on the App page |
| Webhook secret | Change it on the App page and in governance at the same moment. Deliveries in between fail and can be redelivered |
| `RUN_SECRET` | Update it in the scheduler and governance one after the other. Calls between them fail until both match |
| `RUNNER_SECRET` | Update the scheduler and the runner. Jobs fall back to Actions while they differ |
| GitLab token | Create a new token, update `GITLAB_TOKEN`, then revoke the old one |
| Discord bot token | Only used to register the command. Reset it in the Developer Portal whenever needed |

## Restoring from the backup

The backup is plain JSON, one folder per repository. There is no restore command yet: it is on the [roadmap](../ROADMAP.md). The files can be read with any JSON tool to find a lost issue, comment or release note.

## Storage on GitLab

When the storage warning arrives, the three largest projects are named in it. Excluding one in `fleet.json` stops new pushes to it, but the GitLab copy has to be deleted by hand to free the space.
