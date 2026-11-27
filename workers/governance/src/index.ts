// the governance worker: the GitHub App webhook, the daily sweep and the /fleet slash command.

import { type Handlers, handleInteraction, helpText } from "@fleet-ops/chatops";
import { type Fetch, type FleetConfig, GitHub, GitHubApp, notify, parseConfig, signedRunHeaders, verifyGithubWebhook } from "@fleet-ops/core";
import { formatReport, readFleet, sweep } from "./sweep";
import { onPullRequest, type PullRequestEvent, type TokenSource } from "./webhook";

export interface Env {
  FLEET_CONFIG: string;
  GITHUB_APP_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
  GITHUB_WEBHOOK_SECRET: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_APPLICATION_ID: string;
  CHATOPS_OWNER_IDS: string;
  SCHEDULER_URL?: string;
  RUN_SECRET?: string;
  NOTIFY_WEBHOOK_URL?: string;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function callScheduler(env: Env, method: "GET" | "POST", path: string, payload: unknown, doFetch: Fetch): Promise<string> {
  if (!env.SCHEDULER_URL || !env.RUN_SECRET) return "The scheduler is not configured.";
  const body = method === "POST" ? JSON.stringify(payload) : "";
  const res = await doFetch(`${env.SCHEDULER_URL}${path}`, {
    method,
    headers: await signedRunHeaders(env.RUN_SECRET, body),
    ...(method === "POST" ? { body } : {}),
  });
  return `${res.status} ${await res.text()}`.slice(0, 1800);
}

// a sweep over every managed owner, each read with a token that holds only what that step needs
export async function runSweep(
  config: FleetConfig,
  app: TokenSource,
  opts: { dryRun: boolean; only?: string[]; except?: string[] },
  doFetch?: Fetch,
): Promise<string> {
  const reports: string[] = [];
  const net = doFetch ? { fetch: doFetch } : {};
  for (const owner of config.owners) {
    const reader = new GitHub(await app.token(owner, { metadata: "read", administration: "read", contents: "read", pull_requests: "read" }), net);
    const repos = await readFleet(reader, owner);
    // a dry run never asks for a write token at all
    const writer = opts.dryRun ? reader : new GitHub(await app.token(owner, { contents: "write", issues: "write" }), net);
    reports.push(formatReport(await sweep(writer, config, repos, { dryRun: opts.dryRun, only: opts.only, except: opts.except }), opts.dryRun));
  }
  return reports.join("\n\n");
}

export interface WebhookDeps {
  config: FleetConfig;
  app: TokenSource;
  report: (ref: string, detail: string) => void;
  fetch?: Fetch;
}

// the caller is whoever reached the URL, so a failure answers with a fixed message and a reference.
// The detail, which can hold an API response body, goes only to the notify hook under that reference.
export async function handleWebhook(request: Request, secret: string, deps: WebhookDeps): Promise<Response> {
  const body = await request.text();
  if (!(await verifyGithubWebhook(secret, body, request.headers.get("X-Hub-Signature-256")))) return json({ error: "invalid signature" }, 401);
  if (request.headers.get("X-GitHub-Event") !== "pull_request") return json({ skipped: "event not handled" });
  try {
    return json(await onPullRequest(JSON.parse(body) as PullRequestEvent, deps.config, deps.app, deps.fetch ? { fetch: deps.fetch } : {}));
  } catch (err) {
    const ref = crypto.randomUUID().slice(0, 8);
    deps.report(ref, err instanceof Error ? err.message : String(err));
    // a 500 makes GitHub mark the delivery as failed so it can be redelivered
    return json({ error: "the event could not be handled", ref }, 500);
  }
}

export function handlers(env: Env, config: FleetConfig, app: TokenSource, doFetch: Fetch = fetch): Handlers {
  const list = (v: string | boolean | undefined) =>
    typeof v === "string"
      ? v
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean)
      : [];
  const scope = (o: Record<string, string | boolean>) => {
    const only = list(o.repos).filter((r) => r.toLowerCase() !== "all");
    return { only: only.length ? only : undefined, except: list(o.except) };
  };
  return {
    help: async () => helpText(),
    status: async () => callScheduler(env, "GET", "/status", null, doFetch),
    run: async (inv) => callScheduler(env, "POST", "/run", { job: inv.options.job }, doFetch),
    audit: async (inv) => runSweep(config, app, { dryRun: true, ...scope(inv.options) }, doFetch),
    sweep: async (inv) => runSweep(config, app, { dryRun: false, ...scope(inv.options) }, doFetch),
    mirror: async () => callScheduler(env, "POST", "/run", { job: "mirror-sweep" }, doFetch),
    backup: async () => callScheduler(env, "POST", "/run", { job: "backup" }, doFetch),
  };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const config = parseConfig(JSON.parse(env.FLEET_CONFIG));
    const app = new GitHubApp({ appId: env.GITHUB_APP_ID, privateKey: env.GITHUB_APP_PRIVATE_KEY });

    if (request.method === "POST" && url.pathname === "/webhook") {
      return handleWebhook(request, env.GITHUB_WEBHOOK_SECRET, {
        config,
        app,
        report: (ref, detail) => ctx.waitUntil(notify(env.NOTIFY_WEBHOOK_URL, { job: "governance webhook", level: "fail", summary: `${ref}: ${detail}` })),
      });
    }

    if (request.method === "POST" && url.pathname === "/interactions") {
      return handleInteraction(request, env, { handlers: handlers(env, config, app), waitUntil: (p) => ctx.waitUntil(p) });
    }

    return json({ error: "not found" }, 404);
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const config = parseConfig(JSON.parse(env.FLEET_CONFIG));
    const app = new GitHubApp({ appId: env.GITHUB_APP_ID, privateKey: env.GITHUB_APP_PRIVATE_KEY });
    ctx.waitUntil(
      runSweep(config, app, { dryRun: false }).catch((err: unknown) =>
        notify(env.NOTIFY_WEBHOOK_URL, { job: "governance sweep", level: "fail", summary: err instanceof Error ? err.message : String(err) }),
      ),
    );
  },
};
