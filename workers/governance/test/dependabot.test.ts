import { describe, expect, it } from "vitest";
import { decide, diffBump, parseEcosystem, parseGroupedBumps, parseTitleBump, worstBump } from "../src/dependabot";

const policy = { autoMerge: ["patch", "minor"] as ("patch" | "minor" | "major")[], majorAllowed: ["github_actions"] };
const pr = (headRef: string, title: string, body: string | null = null, author = "dependabot[bot]") => ({ author, headRef, title, body });

describe("version parsing", () => {
  it("classifies a bump by the first number that changed", () => {
    expect(diffBump("1.2.3", "2.0.0")).toBe("major");
    expect(diffBump("1.2.3", "1.3.0")).toBe("minor");
    expect(diffBump("1.2.3", "1.2.4")).toBe("patch");
    expect(diffBump("1.4.1", "1.4.1.post1")).toBe("patch");
    expect(diffBump("1.2.3", "1.2.3")).toBe("unknown");
    expect(diffBump("latest", "1.0.0")).toBe("unknown");
  });

  it("reads a single update title with or without a prefix", () => {
    expect(parseTitleBump("Bump vitest from 5.1.1 to 5.1.2")).toBe("patch");
    expect(parseTitleBump("chore(deps): bump actions/checkout from v4.3.0 to v5.0.0")).toBe("major");
    expect(parseTitleBump("chore(deps): bump the npm-minor-patch group with 3 updates")).toBe("unknown");
  });

  it("reads every line of a grouped update body and ignores quoted release notes", () => {
    const body = ["Updates `vitest` from 5.1.1 to 5.1.2", "Updates `wrangler` from 4.165.0 to 4.168.0", "", "> Updates `old` from 1.0.0 to 9.0.0 in the release notes"].join("\n");
    expect(parseGroupedBumps(body)).toEqual(["patch", "minor"]);
  });

  it("lets the worst line decide and holds when any line is unreadable", () => {
    expect(worstBump(["patch", "minor"])).toBe("minor");
    expect(worstBump(["patch", "major"])).toBe("major");
    expect(worstBump(["patch", "unknown"])).toBe("unknown");
    expect(worstBump([])).toBe("unknown");
  });

  it("reads the ecosystem from the branch name", () => {
    expect(parseEcosystem("dependabot/npm_and_yarn/vitest-5.1.2")).toBe("npm_and_yarn");
    expect(parseEcosystem("feature/dependabot")).toBeNull();
  });
});

describe("decide", () => {
  it("merges patch and minor updates", () => {
    expect(decide(pr("dependabot/pip/python/requests-2.34.3", "Bump requests from 2.34.2 to 2.34.3"), policy).merge).toBe(true);
    expect(decide(pr("dependabot/npm_and_yarn/wrangler-4.168.0", "Bump wrangler from 4.165.0 to 4.168.0"), policy).merge).toBe(true);
  });

  it("merges a major GitHub Actions update but holds a major npm one", () => {
    expect(decide(pr("dependabot/github_actions/actions/checkout-5", "Bump actions/checkout from 4.3.0 to 5.0.0"), policy).merge).toBe(true);
    const held = decide(pr("dependabot/npm_and_yarn/typescript-7.0.2", "Bump typescript from 5.9.3 to 7.0.2"), policy);
    expect(held).toEqual({ merge: false, reason: "major npm_and_yarn update held for review" });
  });

  it("holds a grouped update with one major line", () => {
    const body = "Updates `vitest` from 5.1.1 to 5.1.2\nUpdates `typescript` from 5.9.3 to 7.0.2";
    expect(decide(pr("dependabot/npm_and_yarn/npm-minor-patch-1a2b", "Bump the npm group with 2 updates", body), policy).merge).toBe(false);
  });

  it("refuses a lookalike branch opened by someone else", () => {
    expect(decide(pr("dependabot/npm_and_yarn/evil", "Bump x from 1.0.0 to 1.0.1", null, "someone"), policy)).toEqual({ merge: false, reason: "not opened by Dependabot" });
  });

  it("holds what it cannot read", () => {
    expect(decide(pr("dependabot/npm_and_yarn/x", "Update x"), policy).merge).toBe(false);
  });

  it("respects a policy that only merges patches", () => {
    expect(decide(pr("dependabot/pip/x", "Bump x from 1.2.0 to 1.3.0"), { autoMerge: ["patch"], majorAllowed: [] }).merge).toBe(false);
  });
});
