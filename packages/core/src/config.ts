// fleet.json drives every service. It is validated once at start-up and every problem is reported
// together, so a bad edit is fixed in one pass instead of one error per deploy.

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export const WEEKDAYS: readonly Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export type Route = "containers" | "actions";

export interface Job {
  name: string;
  repo: string;
  workflow: string;
  at: string;
  days: "daily" | Weekday[];
  route: Route;
}

export interface Label {
  name: string;
  color: string;
  description: string;
}

export type UpdateType = "patch" | "minor" | "major";

export interface FleetConfig {
  owners: string[];
  exclude: string[];
  scheduler: { timezone: string; jobs: Job[] };
  governance: {
    staleBranchDays: number;
    staleIssueDays: number;
    dependabot: { autoMerge: UpdateType[]; majorAllowed: string[] };
    labels: Label[];
    settings: Record<string, boolean>;
  };
  mirror: { gitlabNamespace: string; sizeWarningMiB: number };
  backup: { timeBudgetMinutes: number };
}

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`fleet.json has ${problems.length} problem(s):\n- ${problems.join("\n- ")}`);
    this.name = "ConfigError";
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isPosInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function parseConfig(raw: unknown): FleetConfig {
  const p: string[] = [];
  if (!isObj(raw)) throw new ConfigError(["the file is not a JSON object"]);

  if (!Array.isArray(raw.owners) || raw.owners.length === 0 || !raw.owners.every(isStr)) p.push("owners must be a non-empty list of account names");
  if (!Array.isArray(raw.exclude) || !raw.exclude.every((r) => isStr(r) && REPO.test(r))) p.push("exclude must be a list of owner/name strings");

  const s = raw.scheduler;
  if (!isObj(s)) p.push("scheduler is missing");
  else {
    if (!isStr(s.timezone)) p.push("scheduler.timezone must be an IANA zone such as Europe/London");
    if (!Array.isArray(s.jobs)) p.push("scheduler.jobs must be a list");
    else {
      const names = new Set<string>();
      s.jobs.forEach((j, i) => {
        const at = `scheduler.jobs[${i}]`;
        if (!isObj(j)) return void p.push(`${at} must be an object`);
        if (!isStr(j.name)) p.push(`${at}.name is required`);
        else if (names.has(j.name)) p.push(`${at}.name "${j.name}" is used twice`);
        else names.add(j.name);
        if (!isStr(j.repo) || !REPO.test(j.repo)) p.push(`${at}.repo must be owner/name`);
        if (!isStr(j.workflow) || !/\.ya?ml$/.test(j.workflow)) p.push(`${at}.workflow must be a .yml file name`);
        if (!isStr(j.at) || !TIME.test(j.at)) p.push(`${at}.at must be HH:MM in 24 hour time`);
        const daysOk = j.days === "daily" || (Array.isArray(j.days) && j.days.length > 0 && j.days.every((d) => WEEKDAYS.includes(d as Weekday)));
        if (!daysOk) p.push(`${at}.days must be "daily" or a list such as ["mon", "thu"]`);
        if (j.route !== "containers" && j.route !== "actions") p.push(`${at}.route must be "containers" or "actions"`);
      });
    }
  }

  const g = raw.governance;
  if (!isObj(g)) p.push("governance is missing");
  else {
    if (!isPosInt(g.staleBranchDays)) p.push("governance.staleBranchDays must be a whole number above 0");
    if (!isPosInt(g.staleIssueDays)) p.push("governance.staleIssueDays must be a whole number above 0");
    const d = g.dependabot;
    if (!isObj(d) || !Array.isArray(d.autoMerge) || !d.autoMerge.every((t) => t === "patch" || t === "minor" || t === "major") || !Array.isArray(d.majorAllowed) || !d.majorAllowed.every(isStr)) {
      p.push("governance.dependabot needs autoMerge (patch, minor or major) and majorAllowed (ecosystem names)");
    }
    if (!Array.isArray(g.labels) || !g.labels.every((l) => isObj(l) && isStr(l.name) && typeof l.color === "string" && /^[0-9a-f]{6}$/i.test(l.color) && typeof l.description === "string")) {
      p.push("governance.labels must be a list of { name, color (6 hex digits), description }");
    }
    if (!isObj(g.settings) || !Object.values(g.settings).every((v) => typeof v === "boolean")) p.push("governance.settings must map setting names to true or false");
  }

  const m = raw.mirror;
  if (!isObj(m) || !isStr(m.gitlabNamespace) || !isPosInt(m.sizeWarningMiB)) p.push("mirror needs gitlabNamespace and sizeWarningMiB");
  const b = raw.backup;
  if (!isObj(b) || !isPosInt(b.timeBudgetMinutes)) p.push("backup.timeBudgetMinutes must be a whole number above 0");

  if (p.length) throw new ConfigError(p);
  return raw as unknown as FleetConfig;
}

// a repository is in scope when its owner is managed and it is not excluded.
export function inScope(config: FleetConfig, fullName: string): boolean {
  const lower = fullName.toLowerCase();
  const owner = lower.split("/")[0];
  return config.owners.some((o) => o.toLowerCase() === owner) && !config.exclude.some((e) => e.toLowerCase() === lower);
}
