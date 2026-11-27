import { describe, expect, it } from "vitest";
import { WriteBudget } from "../src/budget";
import { diffLabels, diffSettings, staleBranches } from "../src/rules";

describe("diffSettings", () => {
  it("lists each setting that differs in the names the REST API uses", () => {
    const actual = { squashMergeAllowed: true, mergeCommitAllowed: true, hasWikiEnabled: false };
    expect(diffSettings(actual, { allow_squash_merge: true, allow_merge_commit: false, has_wiki: false })).toEqual(["allow_merge_commit is true, want false"]);
  });
});

describe("diffLabels", () => {
  const wanted = [
    { name: "bug", color: "d73a4a", description: "Something is not working" },
    { name: "automerge", color: "0e8a16", description: "Merge once checks pass" },
  ];
  it("creates missing labels and corrects changed ones, ignoring case", () => {
    const existing = [{ name: "Bug", color: "D73A4A", description: "old text" }];
    expect(diffLabels(existing, wanted)).toEqual([
      { action: "update", label: wanted[0] },
      { action: "create", label: wanted[1] },
    ]);
  });
  it("never deletes a label the standard does not list", () => {
    const existing = [...wanted, { name: "team-only", color: "000000", description: "" }];
    expect(diffLabels(existing, wanted)).toEqual([]);
  });
});

describe("staleBranches", () => {
  const now = new Date("2026-11-27T00:00:00Z");
  const old = "2026-09-01T00:00:00Z";
  it("picks old branches with no open pull request", () => {
    const branches = [
      { name: "main", lastCommit: old, openPullRequests: 0 },
      { name: "feat/old", lastCommit: old, openPullRequests: 0 },
      { name: "feat/open", lastCommit: old, openPullRequests: 1 },
      { name: "feat/new", lastCommit: "2026-11-20T00:00:00Z", openPullRequests: 0 },
      { name: "release/1.x", lastCommit: old, openPullRequests: 0 },
    ];
    expect(staleBranches(branches, "main", 30, now)).toEqual(["feat/old"]);
  });
});

describe("WriteBudget", () => {
  it("fits inside the free plan with room for reads and counts what it defers", () => {
    const b = new WriteBudget();
    expect(b.remaining).toBe(40);
    expect(b.spend(39)).toBe(true);
    expect(b.spend(2)).toBe(false);
    expect(b.spend()).toBe(true);
    expect(b.deferred).toBe(2);
  });
});
