// pull request events from the GitHub App. Each one gets a token for that one repository with only
// the permissions its action needs.

import { type FleetConfig, GitHub, inScope, type Permissions } from "@fleet-ops/core";
import { decide } from "./dependabot";

export interface TokenSource {
  token(owner: string, permissions: Permissions, repos?: string[]): Promise<string>;
}

export interface PullRequestEvent {
  action: string;
  repository: { full_name: string; default_branch: string };
  pull_request: {
    number: number;
    node_id: string;
    merged: boolean;
    title: string;
    body: string | null;
    user: { login: string };
    head: { ref: string; repo: { full_name: string } | null };
    labels: { name: string }[];
  };
}

export type Outcome = { did: string } | { skipped: string };

// GraphQL is the only API that arms auto-merge. GitHub then merges once the required checks pass,
// so nothing here merges a pull request whose checks have not run.
const ENABLE_AUTO_MERGE = `mutation($id: ID!) { enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: SQUASH }) { clientMutationId } }`;

export async function onPullRequest(
  event: PullRequestEvent,
  config: FleetConfig,
  app: TokenSource,
  fetchOpts: ConstructorParameters<typeof GitHub>[1] = {},
): Promise<Outcome> {
  const repo = event.repository.full_name;
  if (!inScope(config, repo)) return { skipped: `${repo} is not managed` };
  const [owner, name] = repo.split("/") as [string, string];
  const pr = event.pull_request;

  if (event.action === "closed") {
    if (!pr.merged) return { skipped: "closed without merging" };
    // a fork's branch belongs to someone else and the default branch is never removed
    if (pr.head.repo?.full_name !== repo) return { skipped: "head branch is in a fork" };
    if (pr.head.ref === event.repository.default_branch) return { skipped: "head is the default branch" };
    const gh = new GitHub(await app.token(owner, { contents: "write" }, [name]), fetchOpts);
    await gh.deleteBranch(repo, pr.head.ref);
    return { did: `deleted ${pr.head.ref}` };
  }

  if (event.action === "opened" || event.action === "synchronize" || event.action === "reopened" || event.action === "labeled") {
    const labelled = pr.labels.some((l) => l.name === "automerge");
    const decision = labelled
      ? { merge: true, reason: "automerge label" }
      : decide({ author: pr.user.login, headRef: pr.head.ref, title: pr.title, body: pr.body }, config.governance.dependabot);
    if (!decision.merge) return { skipped: decision.reason };
    const gh = new GitHub(await app.token(owner, { contents: "write", pull_requests: "write" }, [name]), fetchOpts);
    await gh.graphql("enable auto-merge", repo, ENABLE_AUTO_MERGE, { id: pr.node_id });
    return { did: `auto-merge armed on #${pr.number}: ${decision.reason}` };
  }

  return { skipped: `action ${event.action} is not handled` };
}
