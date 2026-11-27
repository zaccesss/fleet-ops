import { readFileSync } from "node:fs";
import { parseConfig, RUN_SIGNATURE_HEADER, RUN_TIMESTAMP_HEADER, verifyRun } from "@fleet-ops/core";
import { fakeFetch } from "@fleet-ops/core/testing";
import { describe, expect, it } from "vitest";
import { type Env, handlers, runSweep } from "../src/index";

const config = parseConfig(JSON.parse(readFileSync(new URL("../../../config/fleet.example.json", import.meta.url), "utf8")));
const SECRET = "r".repeat(32);

const env = (overrides: Partial<Env> = {}): Env => ({
  FLEET_CONFIG: "{}",
  GITHUB_APP_ID: "1",
  GITHUB_APP_PRIVATE_KEY: "unused",
  GITHUB_WEBHOOK_SECRET: "w".repeat(32),
  DISCORD_PUBLIC_KEY: "00",
  DISCORD_APPLICATION_ID: "app",
  CHATOPS_OWNER_IDS: "owner",
  SCHEDULER_URL: "https://scheduler.example.invalid",
  RUN_SECRET: SECRET,
  ...overrides,
});

const inv = (options: Record<string, string> = {}) => ({ subcommand: "run" as const, options, userId: "owner" });

function recordingApp() {
  const asked: unknown[][] = [];
  return {
    asked,
    token: async (...args: unknown[]) => {
      asked.push(args);
      return "ghs_test";
    },
  };
}

// one empty page of repositories for each owner
const emptyFleet = {
  method: "POST",
  match: "/graphql",
  answer: { json: { data: { repositoryOwner: { repositories: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } } } },
};

describe("handlers", () => {
  it("starts a job on the scheduler with a signed call", async () => {
    const f = fakeFetch([{ method: "POST", match: "scheduler.example.invalid/run", answer: { json: { ok: true } } }]);
    const out = await handlers(env(), config, recordingApp(), f.fetch).run(inv({ job: "backup" }));
    expect(out).toMatch(/^200 /);
    const call = f.calls[0];
    expect(call?.body).toEqual({ job: "backup" });
    const ok = await verifyRun(SECRET, JSON.stringify(call?.body), call?.headers[RUN_TIMESTAMP_HEADER] ?? null, call?.headers[RUN_SIGNATURE_HEADER] ?? null);
    expect(ok).toBe(true);
  });

  it("maps mirror and backup to their scheduled jobs and reads status", async () => {
    const f = fakeFetch([
      { method: "POST", match: "/run", answer: { json: {} } },
      { method: "GET", match: "/status", answer: { json: { jobs: [] } } },
    ]);
    const h = handlers(env(), config, recordingApp(), f.fetch);
    await h.mirror(inv());
    await h.backup(inv());
    await h.status(inv());
    expect(f.calls.map((c) => c.body ?? c.method)).toEqual([{ job: "mirror-sweep" }, { job: "backup" }, "GET"]);
  });

  it("says so when the scheduler is not configured", async () => {
    expect(await handlers(env({ SCHEDULER_URL: undefined }), config, recordingApp()).status(inv())).toBe("The scheduler is not configured.");
  });

  it("answers help with the command list", async () => {
    expect(await handlers(env(), config, recordingApp()).help(inv())).toContain("/fleet audit");
  });
});

describe("runSweep", () => {
  it("audits every owner with read tokens only", async () => {
    const app = recordingApp();
    const f = fakeFetch([emptyFleet]);
    const out = await runSweep(config, app, { dryRun: true }, f.fetch);
    expect(out).toContain("Audit of 0 repositories.");
    expect(app.asked.map((a) => a[0])).toEqual(["example-user", "example-org"]);
    for (const [, permissions] of app.asked) expect(Object.values(permissions as object)).not.toContain("write");
  });

  it("asks for write tokens only on a real sweep", async () => {
    const app = recordingApp();
    await runSweep(config, app, { dryRun: false }, fakeFetch([emptyFleet]).fetch);
    expect(app.asked.filter((a) => Object.values(a[1] as object).includes("write"))).toHaveLength(2);
  });
});
