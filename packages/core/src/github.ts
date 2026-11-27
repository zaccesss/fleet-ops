// a thin GitHub REST and GraphQL client. Every call goes through one helper so headers, retries and
// errors behave the same everywhere. A failure carries the operation, the repository, the status
// and the body up to whoever reports it. A token is never logged.

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export class GithubError extends Error {
  constructor(
    public readonly op: string,
    public readonly repo: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`${op} on ${repo} failed: ${status} ${body.slice(0, 400)}`);
    this.name = "GithubError";
  }
}

export const API = "https://api.github.com";

export function ghHeaders(token: string, userAgent = "fleet-ops"): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": userAgent,
  };
}

// brief server-side errors that usually clear on the next attempt. A 4xx is a real answer and is
// returned at once, since retrying it would fail the same way.
const RETRYABLE = new Set([502, 503, 504]);

export interface RetryOptions {
  fetch?: Fetch;
  attempts?: number;
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function fetchWithRetry(url: string, init: RequestInit = {}, opts: RetryOptions = {}): Promise<Response> {
  const doFetch = opts.fetch ?? fetch;
  const attempts = opts.attempts ?? 3;
  const backoff = opts.backoffMs ?? 400;
  const sleep = opts.sleep ?? realSleep;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await doFetch(url, init);
      if (attempt >= attempts || !RETRYABLE.has(res.status)) return res;
    } catch (err) {
      if (attempt >= attempts) throw err;
    }
    await sleep(backoff * attempt);
  }
}

export class GitHub {
  constructor(
    private readonly token: string,
    private readonly opts: RetryOptions & { userAgent?: string } = {},
  ) {}

  // returns parsed JSON. A 204 gives null, as does a 404 the caller expects (a branch already gone).
  async rest<T>(op: string, repo: string, path: string, init: RequestInit = {}, allow404 = false): Promise<T | null> {
    const url = path.startsWith("http") ? path : `${API}${path}`;
    const headers = {
      ...ghHeaders(this.token, this.opts.userAgent),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...((init.headers as Record<string, string>) ?? {}),
    };
    const res = await fetchWithRetry(url, { ...init, headers }, this.opts);
    if (res.status === 404 && allow404) return null;
    if (!res.ok) throw new GithubError(op, repo, res.status, await res.text());
    if (res.status === 204) return null;
    return (await res.json()) as T;
  }

  // one GraphQL call reads a whole batch of repositories, where REST would spend one request per
  // repository. GraphQL answers 200 even when it refuses a field, so an errors array is a failure.
  async graphql<T>(op: string, repo: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const res = await fetchWithRetry(
      `${API}/graphql`,
      {
        method: "POST",
        headers: { ...ghHeaders(this.token, this.opts.userAgent), "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables }),
      },
      this.opts,
    );
    if (!res.ok) throw new GithubError(op, repo, res.status, await res.text());
    const body = (await res.json()) as { data?: T; errors?: unknown };
    if (body.errors) throw new GithubError(op, repo, 200, JSON.stringify(body.errors).slice(0, 800));
    return body.data as T;
  }

  // a branch that is already gone counts as deleted: GitHub answers 404 when the ref never existed
  // and 422 when delete_branch_on_merge removed it a moment earlier.
  async deleteBranch(repo: string, branch: string): Promise<void> {
    try {
      await this.rest("delete branch", repo, `/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, { method: "DELETE" });
    } catch (err) {
      if (err instanceof GithubError && (err.status === 404 || (err.status === 422 && err.body.includes("Reference does not exist")))) return;
      throw err;
    }
  }
}
