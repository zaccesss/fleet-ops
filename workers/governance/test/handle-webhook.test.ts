import { readFileSync } from "node:fs";
import { hmacSha256Hex, parseConfig } from "@fleet-ops/core";
import { fakeFetch } from "@fleet-ops/core/testing";
import { describe, expect, it } from "vitest";
import { handleWebhook } from "../src/index";

const config = parseConfig(JSON.parse(readFileSync(new URL("../../../config/fleet.example.json", import.meta.url), "utf8")));
const SECRET = "w".repeat(32);

const merged = JSON.stringify({
  action: "closed",
  repository: { full_name: "example-user/site", default_branch: "main" },
  pull_request: {
    number: 1,
    node_id: "n",
    merged: true,
    title: "t",
    body: null,
    user: { login: "u" },
    head: { ref: "feat/x", repo: { full_name: "example-user/site" } },
    labels: [],
  },
});

async function delivery(body: string, event = "pull_request", secret = SECRET): Promise<Request> {
  return new Request("https://governance.example.invalid/webhook", {
    method: "POST",
    headers: { "X-GitHub-Event": event, "X-Hub-Signature-256": `sha256=${await hmacSha256Hex(secret, body)}` },
    body,
  });
}

describe("handleWebhook", () => {
  it("refuses a delivery signed with another secret", async () => {
    const res = await handleWebhook(await delivery(merged, "pull_request", "x".repeat(32)), SECRET, {
      config,
      app: { token: async () => "t" },
      report: () => {},
    });
    expect(res.status).toBe(401);
  });

  it("ignores events it does not handle", async () => {
    const res = await handleWebhook(await delivery("{}", "push"), SECRET, { config, app: { token: async () => "t" }, report: () => {} });
    expect(await res.json()).toEqual({ skipped: "event not handled" });
  });

  it("keeps the error detail out of the response and reports it under the same reference", async () => {
    const reported: [string, string][] = [];
    const f = fakeFetch([{ method: "DELETE", match: "/git/refs/heads/", answer: { status: 403, text: "internal detail from the API" } }]);
    const res = await handleWebhook(await delivery(merged), SECRET, {
      config,
      app: { token: async () => "t" },
      report: (ref, detail) => reported.push([ref, detail]),
      fetch: f.fetch,
    });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("internal detail");
    const { ref } = JSON.parse(text) as { ref: string };
    expect(reported).toEqual([[ref, expect.stringContaining("internal detail from the API")]]);
  });
});
