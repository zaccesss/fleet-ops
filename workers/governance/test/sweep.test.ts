import { readFileSync } from "node:fs";
import { GitHub, parseConfig } from "@fleet-ops/core";
import { fakeFetch } from "@fleet-ops/core/testing";
import { describe, expect, it } from "vitest";
import { WriteBudget } from "../src/budget";
import { formatReport, type RepoFacts, readFleet, sweep } from "../src/sweep";

const config = parseConfig(JSON.parse(readFileSync(new URL("../../../config/fleet.example.json", import.meta.url), "utf8")));
const now = new Date("2026-11-27T00:00:00Z");

function repo(name: string, overrides: Partial<RepoFacts> = {}): RepoFacts {
  return {
    nameWithOwner: `example-user/${name}`,
    isArchived: false,
    isFork: false,
    defaultBranch: "main",
    settings: { squashMergeAllowed: true, mergeCommitAllowed: false, rebaseMergeAllowed: false, deleteBranchOnMerge: true, autoMergeAllowed: true, hasWikiEnabled: false },
    labels: config.governance.labels,
    branches: [{ name: "main", lastCommit: "2026-11-26T00:00:00Z", openPullRequests: 0 }],
    ...overrides,
  };
}

const writes = () =>
  fakeFetch([
    { method: "POST", match: /\/labels$/, answer: { status: 201, json: {} } },
    { method: "PATCH", match: /\/labels\//, answer: { json: {} } },
    { method: "DELETE", match: /\/git\/refs\/heads\//, answer: { status: 204 } },
  ]);

describe("sweep", () => {
  it("syncs labels, deletes stale branches and reports drift", async () => {
    const f = writes();
    const repos = [
      repo("site", { labels: [], branches: [{ name: "main", lastCommit: "2026-11-26T00:00:00Z", openPullRequests: 0 }, { name: "feat/old", lastCommit: "2026-08-01T00:00:00Z", openPullRequests: 0 }] }),
      repo("docs", { settings: { ...repo("x").settings, hasWikiEnabled: true } }),
    ];
    const report = await sweep(new GitHub("t", { fetch: f.fetch }), config, repos, { now });
    expect(report.labelsChanged).toHaveLength(config.governance.labels.length);
    expect(report.branchesDeleted).toEqual(["example-user/site: feat/old"]);
    expect(report.drift).toEqual(["example-user/docs: has_wiki is true, want false"]);
  });

  it("changes nothing on a dry run", async () => {
    const f = writes();
    const report = await sweep(new GitHub("t", { fetch: f.fetch }), config, [repo("site", { labels: [] })], { dryRun: true, now });
    expect(f.calls).toHaveLength(0);
    expect(report.labelsChanged).toEqual([]);
  });

  it("skips archived, forked, excluded and out-of-scope repositories", async () => {
    const f = writes();
    const repos = [repo("a", { isArchived: true, labels: [] }), repo("b", { isFork: true, labels: [] }), repo("archive-only", { labels: [] }), { ...repo("c", { labels: [] }), nameWithOwner: "stranger/c" }];
    const report = await sweep(new GitHub("t", { fetch: f.fetch }), config, repos, { now });
    expect(report.repos).toBe(0);
    expect(f.calls).toHaveLength(0);
  });

  it("honours only and except, by short or full name", async () => {
    const f = writes();
    const repos = [repo("a"), repo("b"), repo("c")];
    expect((await sweep(new GitHub("t", { fetch: f.fetch }), config, repos, { only: ["a", "example-user/b"], except: ["b"], now })).repos).toBe(1);
  });

  it("stops writing when the budget runs out and says how much it deferred", async () => {
    const f = writes();
    const repos = [repo("a", { labels: [] }), repo("b", { labels: [] })];
    const report = await sweep(new GitHub("t", { fetch: f.fetch }), config, repos, { now }, new WriteBudget(5));
    expect(f.calls).toHaveLength(5);
    expect(report.deferred).toBe(3);
    expect(formatReport(report)).toMatch(/3 write\(s\) deferred/);
  });
});

describe("readFleet", () => {
  it("pages through the owner's repositories in one query per page", async () => {
    const node = (name: string) => ({
      nameWithOwner: `example-user/${name}`,
      isArchived: false,
      isFork: false,
      defaultBranchRef: { name: "main" },
      squashMergeAllowed: true,
      labels: { nodes: [] },
      refs: { nodes: [{ name: "main", target: { committedDate: "2026-11-01T00:00:00Z" }, associatedPullRequests: { totalCount: 0 } }] },
    });
    const f = fakeFetch([
      { method: "POST", match: "/graphql", times: 1, answer: { json: { data: { repositoryOwner: { repositories: { pageInfo: { hasNextPage: true, endCursor: "c1" }, nodes: [node("a")] } } } } } },
      { method: "POST", match: "/graphql", answer: { json: { data: { repositoryOwner: { repositories: { pageInfo: { hasNextPage: false, endCursor: "c2" }, nodes: [node("b")] } } } } } },
    ]);
    const repos = await readFleet(new GitHub("t", { fetch: f.fetch }), "example-user");
    expect(repos.map((r) => r.nameWithOwner)).toEqual(["example-user/a", "example-user/b"]);
    expect((f.calls[1]?.body as { variables: { after: string } }).variables.after).toBe("c1");
    expect(repos[0]?.branches[0]).toEqual({ name: "main", lastCommit: "2026-11-01T00:00:00Z", openPullRequests: 0 });
  });
});
