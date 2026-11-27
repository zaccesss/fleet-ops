# @fleet-ops/core

The code every fleet-ops service shares to verify requests, act as the GitHub App and read the config. It has no runtime dependencies and runs on Cloudflare Workers and Node alike.

| Module          | Exports                                                                                                      | What it does                                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `signatures.ts` | `verifyGithubWebhook`, `verifyDiscordRequest`, `signRun`, `verifyRun`, `signedRunHeaders`, `timingSafeEqual` | HMAC SHA-256 for GitHub webhooks, Ed25519 for Discord and a timestamped HMAC for calls between workers. A secret under 32 characters counts as not configured |
| `app.ts`        | `GitHubApp`, `importAppKey`, `pkcs1ToPkcs8`, `isPkcs1`                                                       | Signs the App JWT, keeps it until a minute before it expires and mints installation tokens limited to the permissions and repositories asked for              |
| `github.ts`     | `GitHub`, `GithubError`, `fetchWithRetry`                                                                    | A REST and GraphQL client. Retries 502, 503 and 504, treats a GraphQL errors array as a failure and counts a branch that is already gone as deleted           |
| `config.ts`     | `parseConfig`, `inScope`, `ConfigError`                                                                      | Validates `fleet.json` and lists every problem at once                                                                                                        |
| `notify.ts`     | `notify`                                                                                                     | Posts a JSON notice and resolves to false instead of throwing                                                                                                 |
| `util.ts`       | `chunk`, `resolveTargets`                                                                                    | Batching and command target parsing                                                                                                                           |
| `encoding.ts`   | hex and base64url helpers                                                                                    | Byte conversions on the web platform APIs, with no Buffer                                                                                                     |

## Example

```ts
import { GitHub, GitHubApp, verifyGithubWebhook } from "@fleet-ops/core";

if (!(await verifyGithubWebhook(env.GITHUB_WEBHOOK_SECRET, rawBody, request.headers.get("X-Hub-Signature-256")))) {
  return new Response("invalid signature", { status: 401 });
}

const app = new GitHubApp({ appId: env.GITHUB_APP_ID, privateKey: env.GITHUB_APP_PRIVATE_KEY });
// this token can delete branches in one repository and do nothing else
const gh = new GitHub(await app.token("example-user", { contents: "write" }, ["site"]));
await gh.deleteBranch("example-user/site", "feat/done");
```

## Testing

Every client takes a `fetch` so tests never reach the network. `@fleet-ops/core/testing` exports `fakeFetch`, which answers scripted routes and records every call:

```ts
import { fakeFetch } from "@fleet-ops/core/testing";

const f = fakeFetch([{ method: "DELETE", match: "/git/refs/heads/", answer: { status: 204 } }]);
await new GitHub("token", { fetch: f.fetch }).deleteBranch("a/b", "old");
expect(f.calls[0]?.method).toBe("DELETE");
```
