// property-based tests for the Dependabot policy: the rules must hold for every version, not only
// the handful of examples in dependabot.test.ts.

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Bump, decide, diffBump, parseGroupedBumps, worstBump } from "../src/dependabot";
import { diffLabels, staleBranches } from "../src/rules";

const part = fc.integer({ min: 0, max: 999 });
const version = fc.tuple(part, part, part);
const show = ([a, b, c]: [number, number, number]) => `${a}.${b}.${c}`;
const rank: Record<Bump, number> = { patch: 0, minor: 1, major: 2, unknown: 3 };
const policy = { autoMerge: ["patch", "minor"] as ("patch" | "minor" | "major")[], majorAllowed: ["github_actions"] };

describe("diffBump", () => {
  it("names the first part that changed", () => {
    fc.assert(
      fc.property(version, version, (from, to) => {
        const bump = diffBump(show(from), show(to));
        if (from[0] !== to[0]) return bump === "major";
        if (from[1] !== to[1]) return bump === "minor";
        if (from[2] !== to[2]) return bump === "patch";
        return bump === "unknown";
      }),
    );
  });

  it("is the same in either direction", () => {
    fc.assert(fc.property(version, version, (a, b) => diffBump(show(a), show(b)) === diffBump(show(b), show(a))));
  });
});

describe("worstBump", () => {
  it("is never milder than any single bump in the list", () => {
    const bump = fc.constantFrom<Bump>("patch", "minor", "major", "unknown");
    fc.assert(
      fc.property(fc.array(bump, { minLength: 1, maxLength: 12 }), (bumps) => {
        const worst = worstBump(bumps);
        return bumps.every((b) => rank[worst] >= rank[b]);
      }),
    );
  });

  it("holds a grouped update whenever one line is a major npm bump", () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(version, version), { maxLength: 6 }), version, (lines, major) => {
        const body = [
          ...lines.map(([a, b]) => `Updates \`dep\` from ${show(a)} to ${show(b)}`),
          `Updates \`big\` from ${show(major)} to ${major[0] + 1}.0.0`,
        ].join("\n");
        expect(parseGroupedBumps(body)).toContain("major");
        return !decide({ author: "dependabot[bot]", headRef: "dependabot/npm_and_yarn/group", title: "Bump the npm group", body }, policy).merge;
      }),
    );
  });
});

describe("decide", () => {
  it("never merges a pull request that Dependabot did not open", () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => s !== "dependabot[bot]"),
        version,
        version,
        (author, a, b) => {
          return !decide({ author, headRef: "dependabot/npm_and_yarn/x", title: `Bump x from ${show(a)} to ${show(b)}`, body: null }, policy).merge;
        },
      ),
    );
  });
});

describe("rules", () => {
  it("never deletes the default branch or a branch with an open pull request", () => {
    const branch = fc.record({
      name: fc.stringMatching(/^[a-z][a-z0-9/-]{0,15}$/),
      lastCommit: fc.date({ min: new Date("2020-01-01"), max: new Date("2026-11-27"), noInvalidDate: true }).map((d) => d.toISOString()),
      openPullRequests: fc.integer({ min: 0, max: 3 }),
    });
    fc.assert(
      fc.property(fc.array(branch, { maxLength: 20 }), fc.integer({ min: 1, max: 365 }), (branches, days) => {
        const stale = staleBranches(branches, "main", days, new Date("2026-11-27T00:00:00Z"));
        return stale.every((name) => name !== "main" && branches.some((b) => b.name === name && b.openPullRequests === 0));
      }),
    );
  });

  it("label sync never proposes a change for a label that already matches", () => {
    const label = fc.record({ name: fc.stringMatching(/^[a-z]{1,10}$/), color: fc.stringMatching(/^[0-9a-f]{6}$/), description: fc.string({ maxLength: 20 }) });
    fc.assert(fc.property(fc.uniqueArray(label, { selector: (l) => l.name, maxLength: 10 }), (labels) => diffLabels(labels, labels).length === 0));
  });
});
