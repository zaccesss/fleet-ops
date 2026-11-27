# @fleet-ops/chatops

The `/fleet` slash command for Discord. The governance worker hosts it at `/interactions` and supplies the handlers.

## What happens to a request

1. The Ed25519 signature is checked against `DISCORD_PUBLIC_KEY` before the body is parsed. A bad signature gets a 401, which Discord itself tests for when the endpoint is saved.
2. A PING is answered with a PONG.
3. The user's ID must be in `CHATOPS_OWNER_IDS`. Anyone else is refused and no handler runs.
4. A subcommand marked as read-only answers at once. One that changes something is deferred, run in the background with `waitUntil` and its reply edited when it finishes.

## Exports

| Export                                       | What it is                                                                             |
| -------------------------------------------- | -------------------------------------------------------------------------------------- |
| `FLEET_COMMAND`                              | The command and its subcommands. Each says whether it changes anything                 |
| `registrationPayload()`                      | The JSON Discord expects, built from `FLEET_COMMAND` so the two never drift apart      |
| `helpText()`                                 | The `/fleet help` reply, built the same way                                            |
| `handleInteraction(request, env, deps)`      | The endpoint. `deps.handlers` maps each subcommand to an async function returning text |
| `registerCommands(appId, botToken, payload)` | Replaces the global command set with one PUT                                           |
| `fitMessage`, `describeError`                | Replies cut to 2,000 characters and errors described with their status                 |

## Registering the command

```sh
DISCORD_APPLICATION_ID=... DISCORD_BOT_TOKEN=... npm run register-commands
```

The [command reference](../../docs/commands.md) lists each subcommand.
