// the pure rules the daily sweep applies. Each takes plain data read from GitHub and returns what
// should change, so the decisions are tested without a network.

import type { Label } from "@fleet-ops/core";

// REST setting names mapped to the GraphQL fields that report them, so one query reads the
// settings of a whole batch of repositories.
export const SETTING_FIELDS: Record<string, string> = {
  allow_squash_merge: "squashMergeAllowed",
  allow_merge_commit: "mergeCommitAllowed",
  allow_rebase_merge: "rebaseMergeAllowed",
  delete_branch_on_merge: "deleteBranchOnMerge",
  allow_auto_merge: "autoMergeAllowed",
  has_wiki: "hasWikiEnabled",
};

export function diffSettings(actual: Record<string, unknown>, standard: Record<string, boolean>): string[] {
  const out: string[] = [];
  for (const [key, want] of Object.entries(standard)) {
    const field = SETTING_FIELDS[key];
    if (field && actual[field] !== want) out.push(`${key} is ${String(actual[field])}, want ${want}`);
  }
  return out;
}

export interface LabelChange {
  action: "create" | "update";
  label: Label;
}

// creates what is missing and corrects colours and descriptions. A label the standard does not
// list is never deleted, since it may be on issues someone relies on.
export function diffLabels(existing: Label[], wanted: Label[]): LabelChange[] {
  const byName = new Map(existing.map((l) => [l.name.toLowerCase(), l]));
  const out: LabelChange[] = [];
  for (const want of wanted) {
    const have = byName.get(want.name.toLowerCase());
    if (!have) out.push({ action: "create", label: want });
    else if (have.color.toLowerCase() !== want.color.toLowerCase() || have.description !== want.description) out.push({ action: "update", label: want });
  }
  return out;
}

export interface BranchFacts {
  name: string;
  lastCommit: string;
  openPullRequests: number;
}

// a branch is stale with no open pull request and no commit for `days`. The default branch and
// anything that looks like a release line are never touched.
export function staleBranches(branches: BranchFacts[], defaultBranch: string, days: number, now: Date): string[] {
  const cutoff = now.getTime() - days * 86_400_000;
  return branches
    .filter((b) => b.name !== defaultBranch && !/^(release|hotfix)\//.test(b.name))
    .filter((b) => b.openPullRequests === 0 && Date.parse(b.lastCommit) < cutoff)
    .map((b) => b.name);
}
