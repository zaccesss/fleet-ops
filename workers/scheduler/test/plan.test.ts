import type { Job } from "@fleet-ops/core";
import { describe, expect, it } from "vitest";
import { localTime } from "../src/clock";
import { GRACE_MINUTES, inWindow, isDue, offGrid, type RunRecord, TICK_MINUTES } from "../src/plan";

const TZ = "Europe/London";
const job = (at: string, days: Job["days"] = "daily"): Job => ({ name: "j", repo: "a/b", workflow: "w.yml", at, days, route: "actions" });

// every tick of one UTC day range, the way the cron trigger would fire
function ticks(fromIso: string, toIso: string): Date[] {
  const out: Date[] = [];
  for (let t = Date.parse(fromIso); t < Date.parse(toIso); t += TICK_MINUTES * 60_000) out.push(new Date(t));
  return out;
}

// runs the plan over a range of ticks and returns the local times a job started at
function simulate(j: Job, from: string, to: string, skip: (d: Date) => boolean = () => false): string[] {
  let last: RunRecord | null = null;
  const starts: string[] = [];
  for (const t of ticks(from, to)) {
    if (skip(t)) continue;
    const now = localTime(t, TZ);
    if (isDue(j, now, last)) {
      last = { date: now.date, at: t.toISOString(), route: "actions", ok: true, detail: "" };
      starts.push(`${now.date} ${String(Math.floor(now.minutes / 60)).padStart(2, "0")}:${String(now.minutes % 60).padStart(2, "0")}`);
    }
  }
  return starts;
}

describe("localTime", () => {
  it("is UTC in winter and an hour ahead in summer", () => {
    expect(localTime(new Date("2026-01-15T23:00:00Z"), TZ)).toEqual({ date: "2026-01-15", weekday: "thu", minutes: 23 * 60 });
    expect(localTime(new Date("2026-07-15T22:00:00Z"), TZ)).toEqual({ date: "2026-07-15", weekday: "wed", minutes: 23 * 60 });
  });
});

describe("the timetable across a year", () => {
  it("starts a 23:00 job at 23:00 local in both winter and summer", () => {
    expect(simulate(job("23:00"), "2026-01-15T00:00:00Z", "2026-01-16T00:00:00Z")).toEqual(["2026-01-15 23:00"]);
    expect(simulate(job("23:00"), "2026-07-15T00:00:00Z", "2026-07-16T00:00:00Z")).toEqual(["2026-07-15 23:00"]);
  });

  it("still runs a 01:30 job on the March day that skips 01:00 to 02:00", () => {
    // clocks went forward at 01:00 UTC on 29 March 2026
    expect(simulate(job("01:30"), "2026-03-28T23:00:00Z", "2026-03-29T06:00:00Z")).toEqual(["2026-03-29 02:00"]);
  });

  it("still runs a 01:00 job on that day, a full hour late", () => {
    expect(simulate(job("01:00"), "2026-03-28T23:00:00Z", "2026-03-29T06:00:00Z")).toEqual(["2026-03-29 02:00"]);
  });

  it("runs a 01:30 job once on the October day that repeats 01:00 to 02:00", () => {
    // clocks went back at 01:00 UTC on 25 October 2026, so 01:30 local happens twice
    expect(simulate(job("01:30"), "2026-10-24T22:00:00Z", "2026-10-25T06:00:00Z")).toEqual(["2026-10-25 01:30"]);
  });

  it("catches up after a skipped tick and gives up after the grace period", () => {
    const missed = (d: Date) => d.toISOString() === "2026-01-15T23:00:00.000Z";
    expect(simulate(job("23:00"), "2026-01-15T22:00:00Z", "2026-01-16T01:00:00Z", missed)).toEqual(["2026-01-15 23:15"]);
    const outage = (d: Date) => d >= new Date("2026-01-15T23:00:00Z") && d < new Date(Date.parse("2026-01-15T23:00:00Z") + GRACE_MINUTES * 60_000);
    expect(simulate(job("23:00"), "2026-01-15T22:00:00Z", "2026-01-16T02:00:00Z", outage)).toEqual([]);
  });

  it("runs a weekly job only on its days", () => {
    // 12 and 16 January 2026 are a Monday and a Friday
    expect(simulate(job("08:30", ["mon", "fri"]), "2026-01-11T00:00:00Z", "2026-01-18T00:00:00Z")).toEqual(["2026-01-12 08:30", "2026-01-16 08:30"]);
  });
});

describe("isDue", () => {
  const now = localTime(new Date("2026-01-15T23:00:00Z"), TZ);
  it("retries a failed start but not a successful one", () => {
    const failed: RunRecord = { date: "2026-01-15", at: "", route: "actions", ok: false, detail: "" };
    expect(isDue(job("23:00"), now, failed)).toBe(true);
    expect(isDue(job("23:00"), now, { ...failed, ok: true })).toBe(false);
    expect(isDue(job("23:00"), now, { ...failed, ok: true, date: "2026-01-14" })).toBe(true);
  });
  it("is not due before its time", () => {
    expect(inWindow(job("23:15"), now)).toBe(false);
  });
});

describe("offGrid", () => {
  it("names a job whose time the tick can never land on", () => {
    expect(offGrid([job("08:30"), { ...job("08:20"), name: "late" }])).toEqual(["late at 08:20 is not on the 15 minute grid"]);
  });
});
