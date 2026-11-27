// the daily sweep: one batched read of the fleet, then label sync, stale branch pruning and a
// drift report. Every write goes through the budget. The drift audit only reports.

import { type FleetConfig, GitHub, inScope, type Label } from "@fleet-ops/core";
import { WriteBudget } from "./budget";
import { type BranchFacts, diffLabels, diffSettings, SETTING_FIELDS, staleBranches } from "./rules";

export interface RepoFacts {
  nameWithOwner: string;
  isArchived: boolean;
  isFork: boolean;
  defaultBranch: string;
  settings: Record<string, unknown>;
  labels: Label[];
  branches: BranchFacts[];
}

interface RepoNode {
  nameWithOwner: string;
  isArchived: boolean;
  isFork: boolean;
  defaultBranchRef: { name: string } | null;
  labels: { nodes: Label[] };
  refs: { nodes: { name: string; target: { committedDate?: string }; associatedPullRequests: { totalCount: number } }[] };
  [field: string]: unknown;
}

// one page of 25 repositories with everything the sweep needs. repositoryOwner works for a user and
// an organisation alike, so the same query covers both.
export const SWEEP_QUERY = `query($login: String!, $after: String) {
  repositoryOwner(login: $login) {
    repositories(first: 25, after: $after, ownerAffiliations: OWNER, orderBy: { field: NAME, direction: ASC }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        nameWithOwner isArchived isFork defaultBranchRef { name }
        ${Object.values(SETTING_FIELDS).join(" ")}
        labels(first: 100) { nodes { name color description } }
        refs(refPrefix: "refs/heads/", first: 100) {
          nodes { name target { ... on Commit { committedDate } } associatedPullRequests(states: OPEN) { totalCount } }
        }
      }
    }
  }
}`;

export async function readFleet(gh: GitHub, login: string): Promise<RepoFacts[]> {
  const out: RepoFacts[] = [];
  let after: string | null = null;
  for (;;) {
    type Page = { repositoryOwner: { repositories: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: RepoNode[] } } | null };
    const data: Page = await gh.graphql<Page>("read fleet", login, SWEEP_QUERY, { login, after });
    const page = data.repositoryOwner?.repositories;
    if (!page) break;
    for (const n of page.nodes) {
      out.push({
        nameWithOwner: n.nameWithOwner,
        isArchived: n.isArchived,
        isFork: n.isFork,
        defaultBranch: n.defaultBranchRef?.name ?? "main",
        settings: Object.fromEntries(Object.values(SETTING_FIELDS).map((f) => [f, n[f]])),
        labels: n.labels.nodes,
        branches: n.refs.nodes.map((r) => ({ name: r.name, lastCommit: r.target.committedDate ?? new Date(0).toISOString(), openPullRequests: r.associatedPullRequests.totalCount })),
      });
    }
    if (!page.pageInfo.hasNextPage) break;
    after = page.pageInfo.endCursor;
  }
  return out;
}

export interface SweepReport {
  repos: number;
  labelsChanged: string[];
  branchesDeleted: string[];
  drift: string[];
  deferred: number;
}

export interface SweepOptions {
  // writes are skipped and only reported, which is what the audit command uses
  dryRun?: boolean;
  only?: string[];
  except?: string[];
  now?: Date;
}

export async function sweep(gh: GitHub, config: FleetConfig, repos: RepoFacts[], opts: SweepOptions = {}, budget = new WriteBudget()): Promise<SweepReport> {
  const now = opts.now ?? new Date();
  const report: SweepReport = { repos: 0, labelsChanged: [], branchesDeleted: [], drift: [], deferred: 0 };
  // a repository can be named in full (owner/name) or by its name alone
  const named = (list: string[] | undefined, full: string) => {
    const short = full.split("/")[1]?.toLowerCase();
    return (list ?? []).some((n) => n.toLowerCase() === full.toLowerCase() || n.toLowerCase() === short);
  };
  const targets = repos.filter(
    (r) => !r.isArchived && !r.isFork && inScope(config, r.nameWithOwner) && (!opts.only || named(opts.only, r.nameWithOwner)) && !named(opts.except, r.nameWithOwner),
  );

  for (const repo of targets) {
    report.repos++;
    for (const line of diffSettings(repo.settings, config.governance.settings)) report.drift.push(`${repo.nameWithOwner}: ${line}`);
    if (opts.dryRun) continue;

    for (const change of diffLabels(repo.labels, config.governance.labels)) {
      if (!budget.spend()) continue;
      const { name, color, description } = change.label;
      if (change.action === "create") {
        await gh.rest("create label", repo.nameWithOwner, `/repos/${repo.nameWithOwner}/labels`, { method: "POST", body: JSON.stringify({ name, color, description }) });
      } else {
        await gh.rest("update label", repo.nameWithOwner, `/repos/${repo.nameWithOwner}/labels/${encodeURIComponent(name)}`, { method: "PATCH", body: JSON.stringify({ color, description }) });
      }
      report.labelsChanged.push(`${repo.nameWithOwner}: ${change.action} ${name}`);
    }

    for (const branch of staleBranches(repo.branches, repo.defaultBranch, config.governance.staleBranchDays, now)) {
      if (!budget.spend()) continue;
      await gh.deleteBranch(repo.nameWithOwner, branch);
      report.branchesDeleted.push(`${repo.nameWithOwner}: ${branch}`);
    }
  }
  report.deferred = budget.deferred;
  return report;
}

export function formatReport(r: SweepReport, dryRun = false): string {
  const lines = [`${dryRun ? "Audit" : "Sweep"} of ${r.repos} repositories.`];
  lines.push(r.drift.length ? `Settings drift (${r.drift.length}):\n${r.drift.map((d) => `- ${d}`).join("\n")}` : "No settings drift.");
  if (!dryRun) {
    lines.push(`Labels changed: ${r.labelsChanged.length}. Stale branches deleted: ${r.branchesDeleted.length}.`);
    if (r.deferred) lines.push(`${r.deferred} write(s) deferred to the next run by the write budget.`);
  }
  return lines.join("\n");
}
