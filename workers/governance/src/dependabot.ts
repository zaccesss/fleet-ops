// whether a Dependabot pull request may merge on its own once checks pass.
//
// pure functions with no network, so every case is tested. When anything cannot be read with
// confidence the answer is to hold, because a wrong merge costs far more than a manual one.

import type { UpdateType } from "@fleet-ops/core";

export type Bump = UpdateType | "unknown";

export const DEPENDABOT_LOGIN = "dependabot[bot]";

// Dependabot names its branches dependabot/<ecosystem>/<rest>, which is a far better signal than the title.
export function parseEcosystem(headRef: string): string | null {
  const parts = headRef.split("/");
  if (parts[0] !== "dependabot" || parts.length < 3) return null;
  return parts[1] ?? null;
}

export function diffBump(fromVersion: string, toVersion: string): Bump {
  const from = fromVersion.split(".").map((n) => Number.parseInt(n, 10));
  const to = toVersion.split(".").map((n) => Number.parseInt(n, 10));
  if ([...from.slice(0, 3), ...to.slice(0, 3)].some(Number.isNaN)) return "unknown";
  if ((from[0] ?? 0) !== (to[0] ?? 0)) return "major";
  if ((from[1] ?? 0) !== (to[1] ?? 0)) return "minor";
  if ((from[2] ?? 0) !== (to[2] ?? 0)) return "patch";
  // the first three numbers match yet the strings differ: a fourth number or a build suffix, which
  // cannot change an interface
  return fromVersion.trim() !== toVersion.trim() ? "patch" : "unknown";
}

// a single update's title: "Bump x from 1.2.3 to 1.3.0", with or without a conventional prefix.
export function parseTitleBump(title: string): Bump {
  const m = title.match(/from\s+v?(\d\S*)\s+to\s+v?(\d\S*)/i);
  return m?.[1] && m[2] ? diffBump(m[1], m[2]) : "unknown";
}

// a grouped update's title carries no versions. Its body has one "Updates `name` from a to b" line
// per dependency, so every line is read and the worst one decides. Only lines that start that way
// count, so release notes quoted further down are never read as updates.
export function parseGroupedBumps(body: string | null): Bump[] {
  if (!body) return [];
  return [...body.matchAll(/^Updates\s+`[^`]+`\s+from\s+v?(\S+?)\s+to\s+v?(\S+?)\.?\s*$/gm)].map((m) => diffBump(m[1] ?? "", m[2] ?? ""));
}

export function worstBump(bumps: Bump[]): Bump {
  if (bumps.length === 0 || bumps.includes("unknown")) return "unknown";
  if (bumps.includes("major")) return "major";
  if (bumps.includes("minor")) return "minor";
  return "patch";
}

export interface PullRequestFacts {
  author: string;
  headRef: string;
  title: string;
  body: string | null;
}

export interface Policy {
  autoMerge: UpdateType[];
  majorAllowed: string[];
}

export interface Decision {
  merge: boolean;
  reason: string;
}

export function decide(pr: PullRequestFacts, policy: Policy): Decision {
  // anyone can name a branch dependabot/..., so the author is what proves it came from Dependabot
  if (pr.author !== DEPENDABOT_LOGIN) return { merge: false, reason: "not opened by Dependabot" };
  const ecosystem = parseEcosystem(pr.headRef);
  if (!ecosystem) return { merge: false, reason: "branch name does not name an ecosystem" };
  let bump = parseTitleBump(pr.title);
  if (bump === "unknown") bump = worstBump(parseGroupedBumps(pr.body));
  if (bump === "unknown") return { merge: false, reason: "could not read the versions, held for review" };
  if (bump === "major") {
    if (policy.autoMerge.includes("major") || policy.majorAllowed.includes(ecosystem)) return { merge: true, reason: `major ${ecosystem} update allowed by policy` };
    return { merge: false, reason: `major ${ecosystem} update held for review` };
  }
  if (!policy.autoMerge.includes(bump)) return { merge: false, reason: `${bump} updates are not set to merge` };
  return { merge: true, reason: `${bump} ${ecosystem} update` };
}
