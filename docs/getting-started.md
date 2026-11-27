# Getting started

This sets up all four systems from scratch. Each step says what it produces, so the later steps have what they need.

## What you need

| Tool or account | Used for |
| --- | --- |
| Node.js 22 or later and npm | The workers and their tests |
| Python 3.12 or later | The mirror and the backup |
| A Cloudflare account (the free plan is enough) | The two workers and one KV namespace |
| A GitHub account or organisation to manage | The GitHub App is installed there |
| A GitLab account with a group | The mirror's destination |
| A Discord server you administer | The `/fleet` command, if you want it |

```sh
git clone https://github.com/zaccesss/fleet-ops.git
cd fleet-ops
npm ci
cd python && pip install -e ".[dev]" && cd ..
```

## 1. Write the config

```sh
cp config/fleet.example.json config/fleet.json
```

Set `owners` to the accounts the App will be installed on, the timetable to the jobs you want and `mirror.gitlabNamespace` to your GitLab group. [Configuration](configuration.md) explains every field. `config/fleet.json` is not ignored by git, so keep it out of a public fork.

## 2. Create the GitHub App

Create an App under **Settings, Developer settings, GitHub Apps, New GitHub App** with the permissions and the event in [GitHub App](github-app.md). Leave the webhook URL blank for now.

It produces four values:

| Value | Where it is |
| --- | --- |
| App ID | The App's settings page |
| Client ID | The same page, used by the workflows |
| Private key | **Generate a private key**. GitHub downloads a PKCS1 `.pem`, which the workers accept as it is |
| Webhook secret | Any random string of 32 characters or more, for example from `openssl rand -hex 32` |

Install the App on every account in `owners`.

> [!IMPORTANT]
> Every secret here guards something that can merge, delete or push. Keep them in Cloudflare and GitHub secret stores only. None of them belongs in a file in the repository.

## 3. Create the Discord app (optional)

In the Discord Developer Portal, create an application. Note its **Application ID** and **Public Key**, then create a bot under **Bot** and copy its token. The bot needs no permissions: it only registers the command.

Collect the Discord user IDs of everyone who may run commands (Developer Mode, then right-click a user, **Copy User ID**). They go in `CHATOPS_OWNER_IDS`, comma separated.

## 4. Create the Cloudflare resources

```sh
npx wrangler login
cd workers/scheduler
npx wrangler kv namespace create RUNS
```

Put the namespace ID it prints into `workers/scheduler/wrangler.toml`.

Generate the secret the two workers share for signed calls:

```sh
openssl rand -hex 32
```

## 5. Deploy the scheduler

```sh
cd workers/scheduler
npx wrangler secret put GITHUB_APP_ID
npx wrangler secret put GITHUB_APP_PRIVATE_KEY < /path/to/app.private-key.pem
npx wrangler secret put RUN_SECRET
npx wrangler secret put FLEET_CONFIG < ../../config/fleet.json
npx wrangler deploy
```

Note the URL it prints. The governance worker calls it.

## 6. Deploy governance

```sh
cd ../governance
npx wrangler secret put FLEET_CONFIG < ../../config/fleet.json
npx wrangler secret put GITHUB_APP_ID
npx wrangler secret put GITHUB_APP_PRIVATE_KEY < /path/to/app.private-key.pem
npx wrangler secret put GITHUB_WEBHOOK_SECRET
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_APPLICATION_ID
npx wrangler secret put CHATOPS_OWNER_IDS
npx wrangler secret put SCHEDULER_URL
npx wrangler secret put RUN_SECRET
npx wrangler deploy
```

Then point the App and Discord at it:

- GitHub App webhook URL: `https://<governance worker>/webhook`, with the webhook secret from step 2.
- Discord **Interactions Endpoint URL**: `https://<governance worker>/interactions`. Discord sends a test request on save and only accepts the URL when the signature check answers correctly.

## 7. Register the command

```sh
DISCORD_APPLICATION_ID=... DISCORD_BOT_TOKEN=... npm run register-commands
```

A global command can take up to an hour to appear in every server.

## 8. Set up the workflows

In the repository's **Settings, Secrets and variables, Actions**:

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `FLEET_CONFIG` | The contents of `config/fleet.json` |
| Secret | `GITHUB_APP_CLIENT_ID` | From step 2 |
| Secret | `GITHUB_APP_PRIVATE_KEY` | From step 2 |
| Secret | `GITLAB_TOKEN` | A GitLab token with the `api` and `write_repository` scopes |
| Secret | `NOTIFY_WEBHOOK_URL` | Optional, where failure notices go |
| Variable | `GITLAB_URL` | Optional, for a self-hosted GitLab |
| Variable | `BACKUP_OWNER` and `BACKUP_REPO` | The private repository the backup commits to. Install the App on it |

For the deploy workflow, create an environment called `production` with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

## 9. Check it works

1. `/fleet help` in Discord should list the subcommands.
2. `/fleet audit` should report the settings drift across the fleet without changing anything.
3. Merge a pull request in a managed repository. Its branch should disappear and the App's webhook deliveries should show a 200.
4. `/fleet run job:mirror-sweep` should start the mirror. Its run appears under the repository's Actions tab.

If any step fails, [Operations](operations.md) lists what each error means.
