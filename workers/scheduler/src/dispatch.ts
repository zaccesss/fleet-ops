// starting one job on its route.
//
// "containers" sends a signed call to the container runner, which bills by the second instead of
// the minimum minute Actions charges a private job. "actions" fires a workflow_dispatch. When the
// runner is not configured or refuses the call, the job falls back to Actions, so a runner outage
// delays nothing.

import { type Fetch, GitHub, type Job, type Permissions, signedRunHeaders } from "@fleet-ops/core";

export interface TokenSource {
  token(owner: string, permissions: Permissions, repos?: string[]): Promise<string>;
}

export interface Runner {
  url?: string;
  secret?: string;
}

export interface StartDeps {
  app: TokenSource;
  runner: Runner;
  fetch?: Fetch;
  now?: () => number;
}

export interface StartResult {
  route: "containers" | "actions";
  ok: boolean;
  detail: string;
}

export async function dispatchWorkflow(job: Job, deps: StartDeps): Promise<StartResult> {
  const [owner, name] = job.repo.split("/") as [string, string];
  // the token can start workflows in this one repository and nothing else
  const token = await deps.app.token(owner, { actions: "write", metadata: "read" }, [name]);
  const gh = new GitHub(token, { fetch: deps.fetch });
  const repo = await gh.rest<{ default_branch: string }>("read repository", job.repo, `/repos/${job.repo}`);
  await gh.rest("dispatch workflow", job.repo, `/repos/${job.repo}/actions/workflows/${job.workflow}/dispatches`, {
    method: "POST",
    body: JSON.stringify({ ref: repo?.default_branch ?? "main" }),
  });
  return { route: "actions", ok: true, detail: `dispatched ${job.workflow} on ${job.repo}` };
}

async function callRunner(job: Job, runner: Required<Runner>, deps: StartDeps): Promise<Response> {
  const body = JSON.stringify({ job: job.name });
  return (deps.fetch ?? fetch)(runner.url, { method: "POST", headers: await signedRunHeaders(runner.secret, body, deps.now?.()), body });
}

export async function startJob(job: Job, deps: StartDeps): Promise<StartResult> {
  if (job.route === "containers") {
    const { url, secret } = deps.runner;
    if (!url || !secret) {
      const res = await dispatchWorkflow(job, deps);
      return { ...res, detail: `runner not configured, ${res.detail}` };
    }
    try {
      const res = await callRunner(job, { url, secret }, deps);
      if (res.ok) return { route: "containers", ok: true, detail: `runner accepted ${job.name}` };
      const fallback = await dispatchWorkflow(job, deps);
      return { ...fallback, detail: `runner answered ${res.status}, ${fallback.detail}` };
    } catch (err) {
      const fallback = await dispatchWorkflow(job, deps);
      return { ...fallback, detail: `runner unreachable (${err instanceof Error ? err.message : String(err)}), ${fallback.detail}` };
    }
  }
  return dispatchWorkflow(job, deps);
}
