import { readFileSync } from "node:fs";
import { parseConfig } from "@fleet-ops/core";
import { fakeFetch } from "@fleet-ops/core/testing";
import { describe, expect, it } from "vitest";
import { onPullRequest, type PullRequestEvent } from "../src/webhook";

const config = parseConfig(JSON.parse(readFileSync(new URL("../../../config/fleet.example.json", import.meta.url), "utf8")));

function event(action: string, pr: Partial<PullRequestEvent["pull_request"]> = {}, repo = "example-user/site"): PullRequestEvent {
  return {
    action,
    repository: { full_name: repo, default_branch: "main" },
    pull_request: {
      number: 12,
      node_id: "PR_node",
      merged: false,
      title: "feat: something",
      body: null,
      user: { login: "example-user" },
      head: { ref: "feat/something", repo: { full_name: repo } },
      labels: [],
      ...pr,
    },
  };
}

function app() {
  const asked: unknown[][] = [];
  return {
    asked,
    token: async (...args: unknown[]) => {
      asked.push(args);
      return "ghs_test";
    },
  };
}

describe("onPullRequest", () => {
  it("deletes the branch of a merged pull request with a contents-only token for that repository", async () => {
    const f = fakeFetch([{ method: "DELETE", match: "/repos/example-user/site/git/refs/heads/feat%2Fsomething", answer: { status: 204 } }]);
    const a = app();
    expect(await onPullRequest(event("closed", { merged: true }), config, a, { fetch: f.fetch })).toEqual({ did: "deleted feat/something" });
    expect(a.asked[0]).toEqual(["example-user", { contents: "write" }, ["site"]]);
  });

  it("leaves a fork's branch and an unmerged close alone", async () => {
    const a = app();
    expect(await onPullRequest(event("closed", { merged: true, head: { ref: "x", repo: { full_name: "stranger/site" } } }), config, a)).toEqual({
      skipped: "head branch is in a fork",
    });
    expect(await onPullRequest(event("closed"), config, a)).toEqual({ skipped: "closed without merging" });
    expect(a.asked).toHaveLength(0);
  });

  it("arms auto-merge on an eligible Dependabot update", async () => {
    const f = fakeFetch([{ method: "POST", match: "/graphql", answer: { json: { data: { enablePullRequestAutoMerge: { clientMutationId: null } } } } }]);
    const out = await onPullRequest(
      event("opened", {
        user: { login: "dependabot[bot]" },
        head: { ref: "dependabot/npm_and_yarn/vitest-5.1.2", repo: { full_name: "example-user/site" } },
        title: "Bump vitest from 5.1.1 to 5.1.2",
      }),
      config,
      app(),
      { fetch: f.fetch },
    );
    expect(out).toEqual({ did: "auto-merge armed on #12: patch npm_and_yarn update" });
    expect((f.calls[0]?.body as { variables: { id: string } } | undefined)?.variables.id).toBe("PR_node");
  });

  it("holds a major npm update without asking for a token", async () => {
    const a = app();
    const out = await onPullRequest(
      event("opened", {
        user: { login: "dependabot[bot]" },
        head: { ref: "dependabot/npm_and_yarn/typescript-7", repo: null },
        title: "Bump typescript from 5.9.3 to 7.0.2",
      }),
      config,
      a,
    );
    expect(out).toEqual({ skipped: "major npm_and_yarn update held for review" });
    expect(a.asked).toHaveLength(0);
  });

  it("arms auto-merge on any pull request with the automerge label", async () => {
    const f = fakeFetch([{ method: "POST", match: "/graphql", answer: { json: { data: {} } } }]);
    const out = await onPullRequest(event("labeled", { labels: [{ name: "automerge" }] }), config, app(), { fetch: f.fetch });
    expect(out).toMatchObject({ did: expect.stringContaining("automerge label") });
  });

  it("ignores a repository outside the fleet", async () => {
    expect(await onPullRequest(event("closed", { merged: true }, "stranger/site"), config, app())).toEqual({ skipped: "stranger/site is not managed" });
  });
});
