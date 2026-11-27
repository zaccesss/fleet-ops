import { readFileSync } from "node:fs";
import { type Job, parseConfig, RUN_SIGNATURE_HEADER, RUN_TIMESTAMP_HEADER, signRun, verifyRun } from "@fleet-ops/core";
import { fakeFetch } from "@fleet-ops/core/testing";
import { describe, expect, it } from "vitest";
import { startJob } from "../src/dispatch";
import { handle, type TickDeps, tick } from "../src/index";
import { memoryStore } from "../src/store";

const config = parseConfig(JSON.parse(readFileSync(new URL("../../../config/fleet.example.json", import.meta.url), "utf8")));
const SECRET = "r".repeat(32);
const app = { token: async () => "ghs_test" };

const containerJob: Job = { name: "mirror-sweep", repo: "example-user/fleet-ops", workflow: "mirror.yml", at: "23:00", days: "daily", route: "containers" };

function githubRoutes() {
  return [
    { method: "GET", match: /\/repos\/example-user\/fleet-ops$/, answer: { json: { default_branch: "main" } } },
    { method: "POST", match: /\/actions\/workflows\/[a-z.-]+\/dispatches$/, answer: { status: 204 } },
  ];
}

describe("startJob", () => {
  it("sends a signed call to the runner for a container job", async () => {
    const f = fakeFetch([{ method: "POST", match: "runner.example.invalid", answer: { status: 202, json: {} } }]);
    const res = await startJob(containerJob, {
      app,
      runner: { url: "https://runner.example.invalid/run", secret: SECRET },
      fetch: f.fetch,
      now: () => 1_800_000_000_000,
    });
    expect(res).toMatchObject({ route: "containers", ok: true });
    const call = f.calls[0];
    expect(
      await verifyRun(
        SECRET,
        JSON.stringify(call?.body),
        call?.headers[RUN_TIMESTAMP_HEADER] ?? null,
        call?.headers[RUN_SIGNATURE_HEADER] ?? null,
        1_800_000_000_000,
      ),
    ).toBe(true);
  });

  it("falls back to Actions when the runner refuses", async () => {
    const f = fakeFetch([{ method: "POST", match: "runner.example.invalid", answer: { status: 503 } }, ...githubRoutes()]);
    const res = await startJob(containerJob, { app, runner: { url: "https://runner.example.invalid/run", secret: SECRET }, fetch: f.fetch });
    expect(res).toMatchObject({ route: "actions", ok: true });
    expect(res.detail).toMatch(/runner answered 503/);
    expect(f.calls.at(-1)?.body).toEqual({ ref: "main" });
  });

  it("falls back to Actions when no runner is configured", async () => {
    const f = fakeFetch(githubRoutes());
    const res = await startJob(containerJob, { app, runner: {}, fetch: f.fetch });
    expect(res.detail).toMatch(/runner not configured/);
  });

  it("asks for a token that can only start workflows in the job's repository", async () => {
    const asked: unknown[] = [];
    const f = fakeFetch(githubRoutes());
    await startJob(
      { ...containerJob, route: "actions" },
      {
        app: {
          token: async (...args: unknown[]) => {
            asked.push(args);
            return "t";
          },
        },
        runner: {},
        fetch: f.fetch,
      },
    );
    expect(asked[0]).toEqual(["example-user", { actions: "write", metadata: "read" }, ["fleet-ops"]]);
  });
});

function deps(overrides: Partial<TickDeps> = {}): TickDeps & { store: ReturnType<typeof memoryStore> } {
  const store = memoryStore();
  return { config, store, start: { app, runner: {}, fetch: fakeFetch(githubRoutes()).fetch }, ...overrides } as TickDeps & {
    store: ReturnType<typeof memoryStore>;
  };
}

describe("tick", () => {
  it("starts the 23:00 job at 23:00 UK time and records it", async () => {
    const d = deps();
    const summary = await tick(new Date("2026-01-15T23:00:00Z"), d);
    expect(summary.started).toHaveLength(1);
    expect(d.store.records.get("mirror-sweep")).toMatchObject({ date: "2026-01-15", ok: true });
  });

  it("does nothing on a quiet tick", async () => {
    expect(await tick(new Date("2026-01-15T12:00:00Z"), deps())).toEqual({ started: [], failed: [] });
  });

  it("keeps going when one job fails and reports it once", async () => {
    const both = {
      ...config,
      scheduler: { ...config.scheduler, jobs: [{ ...containerJob, name: "bad", repo: "example-user/missing", route: "actions" as const }, containerJob] },
    };
    const f = fakeFetch([
      { match: /\/repos\/example-user\/missing$/, answer: { status: 404, text: "Not Found" } },
      ...githubRoutes(),
      { method: "POST", match: "notify.example.invalid", answer: { status: 204 } },
    ]);
    const d = deps({ config: both, start: { app, runner: {}, fetch: f.fetch }, notifyUrl: "https://notify.example.invalid", fetch: f.fetch });
    const summary = await tick(new Date("2026-01-15T23:00:00Z"), d);
    expect(summary.started).toHaveLength(1);
    expect(summary.failed[0]).toMatch(/^bad: read repository/);
    expect(f.calls.filter((c) => c.url.includes("notify"))).toHaveLength(1);
    expect(d.store.records.get("bad")?.ok).toBe(false);
  });
});

async function signedRequest(method: string, path: string, body = "", now = 1_800_000_000_000) {
  const ts = String(Math.floor(now / 1000));
  return new Request(`https://scheduler.example.invalid${path}`, {
    method,
    headers: { [RUN_TIMESTAMP_HEADER]: ts, [RUN_SIGNATURE_HEADER]: await signRun(SECRET, ts, body) },
    ...(method === "POST" ? { body } : {}),
  });
}

describe("handle", () => {
  const now = 1_800_000_000_000;

  it("refuses an unsigned request", async () => {
    const res = await handle(new Request("https://scheduler.example.invalid/status"), { RUN_SECRET: SECRET }, deps(), now);
    expect(res.status).toBe(401);
  });

  it("starts a job by name and counts it as the day's run", async () => {
    const d = deps();
    const res = await handle(await signedRequest("POST", "/run", JSON.stringify({ job: "backup" })), { RUN_SECRET: SECRET }, d, now);
    expect(res.status).toBe(200);
    expect(d.store.records.get("backup")?.ok).toBe(true);
  });

  it("answers 404 for a job that does not exist", async () => {
    const res = await handle(await signedRequest("POST", "/run", JSON.stringify({ job: "nope" })), { RUN_SECRET: SECRET }, deps(), now);
    expect(res.status).toBe(404);
  });

  it("reports the last run of every job", async () => {
    const d = deps();
    await tick(new Date("2026-01-15T23:00:00Z"), d);
    const res = await handle(await signedRequest("GET", "/status"), { RUN_SECRET: SECRET }, d, now);
    const out = (await res.json()) as { jobs: { name: string; last: unknown }[] };
    expect(out.jobs.map((j) => j.name)).toEqual(["mirror-sweep", "backup", "weekly-digest"]);
    expect(out.jobs[0]?.last).toMatchObject({ ok: true });
  });
});
