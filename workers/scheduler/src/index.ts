// the scheduler worker. A cron trigger wakes it every 15 minutes. It starts whatever is due and
// reports failures in one notice. Two signed routes let other services start a job or read status.

import { type Fetch, type FleetConfig, GitHubApp, notify, parseConfig, RUN_SIGNATURE_HEADER, RUN_TIMESTAMP_HEADER, verifyRun } from "@fleet-ops/core";
import { localTime } from "./clock";
import { type StartDeps, startJob, type TokenSource } from "./dispatch";
import { isDue, offGrid, type RunRecord } from "./plan";
import { kvStore, type RunStore } from "./store";

export interface Env {
  FLEET_CONFIG: string;
  RUNS: KVNamespace;
  GITHUB_APP_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
  RUN_SECRET: string;
  RUNNER_URL?: string;
  RUNNER_SECRET?: string;
  NOTIFY_WEBHOOK_URL?: string;
}

export interface TickDeps {
  config: FleetConfig;
  store: RunStore;
  start: Omit<StartDeps, "app"> & { app: TokenSource };
  notifyUrl?: string;
  fetch?: Fetch;
}

export interface TickSummary {
  started: string[];
  failed: string[];
}

export async function tick(now: Date, deps: TickDeps): Promise<TickSummary> {
  const local = localTime(now, deps.config.scheduler.timezone);
  const summary: TickSummary = { started: [], failed: [] };
  for (const job of deps.config.scheduler.jobs) {
    try {
      // cheap clock check first, so a quiet tick reads nothing from storage
      if (!isDue(job, local, null)) continue;
      if (!isDue(job, local, await deps.store.last(job.name))) continue;
      const result = await startJob(job, deps.start);
      await deps.store.save(job.name, { date: local.date, at: now.toISOString(), ...result });
      summary.started.push(`${job.name}: ${result.detail}`);
    } catch (err) {
      // one failing job never stops the rest of the tick. It is not marked done, so the next
      // tick inside its window tries again.
      const detail = err instanceof Error ? err.message : String(err);
      await deps.store.save(job.name, { date: local.date, at: now.toISOString(), route: job.route, ok: false, detail }).catch(() => {});
      summary.failed.push(`${job.name}: ${detail}`);
    }
  }
  if (summary.failed.length) {
    await notify(deps.notifyUrl, { job: "scheduler", level: "fail", summary: `${summary.failed.length} job(s) failed to start`, details: summary.failed }, deps.fetch);
  }
  return summary;
}

function depsFrom(env: Env): TickDeps {
  const config = parseConfig(JSON.parse(env.FLEET_CONFIG));
  const grid = offGrid(config.scheduler.jobs);
  if (grid.length) throw new Error(grid.join("; "));
  return {
    config,
    store: kvStore(env.RUNS),
    start: { app: new GitHubApp({ appId: env.GITHUB_APP_ID, privateKey: env.GITHUB_APP_PRIVATE_KEY }), runner: { url: env.RUNNER_URL, secret: env.RUNNER_SECRET } },
    notifyUrl: env.NOTIFY_WEBHOOK_URL,
  };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export async function handle(request: Request, env: Pick<Env, "RUN_SECRET">, deps: TickDeps, now = Date.now()): Promise<Response> {
  const url = new URL(request.url);
  const body = request.method === "POST" ? await request.text() : "";
  const signed = await verifyRun(env.RUN_SECRET, body, request.headers.get(RUN_TIMESTAMP_HEADER), request.headers.get(RUN_SIGNATURE_HEADER), now);
  if (!signed) return json({ error: "invalid signature" }, 401);

  if (request.method === "POST" && url.pathname === "/run") {
    const { job: name } = JSON.parse(body) as { job?: string };
    const job = deps.config.scheduler.jobs.find((j) => j.name === name);
    if (!job) return json({ error: `no job named ${name}` }, 404);
    const result = await startJob(job, deps.start);
    const local = localTime(new Date(now), deps.config.scheduler.timezone);
    // a manual start counts as the day's run, so the timetable does not start it a second time
    await deps.store.save(job.name, { date: local.date, at: new Date(now).toISOString(), ...result });
    return json(result);
  }

  if (request.method === "GET" && url.pathname === "/status") {
    const jobs: { name: string; at: string; route: string; last: RunRecord | null }[] = [];
    for (const job of deps.config.scheduler.jobs) jobs.push({ name: job.name, at: job.at, route: job.route, last: await deps.store.last(job.name) });
    return json({ timezone: deps.config.scheduler.timezone, jobs });
  }

  return json({ error: "not found" }, 404);
}

export default {
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(tick(new Date(controller.scheduledTime), depsFrom(env)));
  },
  async fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env, depsFrom(env));
  },
};
