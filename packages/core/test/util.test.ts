import { describe, expect, it } from "vitest";
import { notify } from "../src/notify";
import { chunk, resolveTargets } from "../src/util";
import { fakeFetch } from "./fake-fetch";

describe("chunk", () => {
  it("splits into groups and keeps the remainder", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });
  it("refuses a size below 1", () => {
    expect(() => chunk([1], 0)).toThrow();
  });
});

describe("resolveTargets", () => {
  const all = ["site", "Docs", "api"];
  it("treats empty and all as every repository", () => {
    expect(resolveTargets(undefined, undefined, all).targets).toEqual(all);
    expect(resolveTargets("all", "", all).targets).toEqual(all);
  });
  it("matches without case, applies except and reports unknown names", () => {
    expect(resolveTargets("docs, SITE, nope", "site", all)).toEqual({ targets: ["Docs"], unknown: ["nope"] });
  });
});

describe("notify", () => {
  it("posts the notice and reports success", async () => {
    const f = fakeFetch([{ method: "POST", match: "example.invalid", answer: { status: 204 } }]);
    expect(await notify("https://example.invalid/hook", { job: "sweep", level: "ok", summary: "done" }, f.fetch)).toBe(true);
    expect(f.calls[0]?.body).toMatchObject({ job: "sweep", level: "ok", summary: "done" });
  });
  it("never throws, whatever happens", async () => {
    const failing = async () => {
      throw new Error("down");
    };
    expect(await notify("https://example.invalid/hook", { job: "x", level: "fail", summary: "y" }, failing)).toBe(false);
    expect(await notify(undefined, { job: "x", level: "fail", summary: "y" })).toBe(false);
  });
  it("caps the details list", async () => {
    const f = fakeFetch([{ method: "POST", match: "example.invalid", answer: { status: 200 } }]);
    await notify("https://example.invalid/hook", { job: "x", level: "warn", summary: "y", details: Array.from({ length: 40 }, (_, i) => `r${i}`) }, f.fetch);
    expect((f.calls[0]?.body as { details: string[] }).details).toHaveLength(25);
  });
});
