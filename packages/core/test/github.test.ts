import { describe, expect, it } from "vitest";
import { fetchWithRetry, GitHub, GithubError } from "../src/github";
import { fakeFetch } from "./fake-fetch";

const noSleep = async () => {};

describe("fetchWithRetry", () => {
  it("retries a 502 and returns the later success", async () => {
    const f = fakeFetch([
      { match: "/x", answer: { status: 502 }, times: 1 },
      { match: "/x", answer: { json: { ok: true } } },
    ]);
    const res = await fetchWithRetry("https://api.github.com/x", {}, { fetch: f.fetch, sleep: noSleep });
    expect(res.status).toBe(200);
    expect(f.calls).toHaveLength(2);
  });

  it("returns a 404 at once without retrying", async () => {
    const f = fakeFetch([{ match: "/x", answer: { status: 404 } }]);
    const res = await fetchWithRetry("https://api.github.com/x", {}, { fetch: f.fetch, sleep: noSleep });
    expect(res.status).toBe(404);
    expect(f.calls).toHaveLength(1);
  });

  it("gives up after the last attempt and returns its answer", async () => {
    const f = fakeFetch([{ match: "/x", answer: { status: 503 } }]);
    const res = await fetchWithRetry("https://api.github.com/x", {}, { fetch: f.fetch, sleep: noSleep, attempts: 3 });
    expect(res.status).toBe(503);
    expect(f.calls).toHaveLength(3);
  });

  it("rethrows a network error on the last attempt", async () => {
    const failing = async () => {
      throw new TypeError("network down");
    };
    await expect(fetchWithRetry("https://api.github.com/x", {}, { fetch: failing, sleep: noSleep })).rejects.toThrow("network down");
  });
});

describe("GitHub", () => {
  it("sends the token and API version and parses JSON", async () => {
    const f = fakeFetch([{ match: "/repos/a/b", answer: { json: { name: "b" } } }]);
    const gh = new GitHub("tok", { fetch: f.fetch });
    expect(await gh.rest<{ name: string }>("get repo", "a/b", "/repos/a/b")).toEqual({ name: "b" });
    expect(f.calls[0]?.headers.Authorization).toBe("Bearer tok");
    expect(f.calls[0]?.headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
  });

  it("carries the operation, repository, status and body in an error", async () => {
    const f = fakeFetch([{ match: "/repos/a/b", answer: { status: 403, text: "Resource not accessible" } }]);
    const err: GithubError = (await new GitHub("tok", { fetch: f.fetch }).rest("get repo", "a/b", "/repos/a/b").catch((e: GithubError) => e)) as GithubError;
    expect(err).toBeInstanceOf(GithubError);
    expect(err).toMatchObject({ op: "get repo", repo: "a/b", status: 403 });
    expect(String(err.message)).not.toContain("tok");
  });

  it("treats an errors array in a GraphQL 200 as a failure", async () => {
    const f = fakeFetch([{ method: "POST", match: "/graphql", answer: { json: { errors: [{ message: "Field x missing" }] } } }]);
    await expect(new GitHub("tok", { fetch: f.fetch }).graphql("read", "a/b", "{ x }")).rejects.toThrow(/Field x missing/);
  });

  it("counts a branch that is already gone as deleted", async () => {
    const f = fakeFetch([
      { method: "DELETE", match: "/refs/heads/one", answer: { status: 404 } },
      { method: "DELETE", match: "/refs/heads/two", answer: { status: 422, text: "Reference does not exist" } },
      { method: "DELETE", match: "/refs/heads/three", answer: { status: 403, text: "no" } },
    ]);
    const gh = new GitHub("tok", { fetch: f.fetch });
    await expect(gh.deleteBranch("a/b", "one")).resolves.toBeUndefined();
    await expect(gh.deleteBranch("a/b", "two")).resolves.toBeUndefined();
    await expect(gh.deleteBranch("a/b", "three")).rejects.toBeInstanceOf(GithubError);
  });
});
