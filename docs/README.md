# Documentation

| Page | What it covers |
| --- | --- |
| [Getting started](getting-started.md) | Creating the GitHub App and the Discord app, the Cloudflare resources, every secret and the order to deploy in |
| [Configuration](configuration.md) | Every field in `fleet.json` and every environment variable, service by service |
| [GitHub App](github-app.md) | The permissions and events the App needs and which part uses each one |
| [Commands](commands.md) | The `/fleet` slash command and each subcommand |
| [Architecture](architecture.md) | How the parts connect, each path end to end and the trust boundaries |
| [Operations](operations.md) | What a failure notice means, how to run a job by hand and how to rotate each secret |
| [Testing](testing.md) | How the tests avoid real APIs, the coverage thresholds and what CI runs |
| [Decision records](decisions) | The trade-offs behind the design |

Each part also has its own README: [core](../packages/core), [chatops](../packages/chatops), [scheduler](../workers/scheduler), [governance](../workers/governance), [mirror](../python/mirror) and [backup](../python/backup).
