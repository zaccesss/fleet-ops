// property-based test for the timetable: for any job time on the grid and any day of 2026,
// clock changes included, a daily job starts exactly once in that local day.

import type { Job } from "@fleet-ops/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { localTime } from "../src/clock";
import { isDue, type RunRecord, TICK_MINUTES } from "../src/plan";

const TZ = "Europe/London";

describe("the timetable", () => {
  it("starts a daily job exactly once per local day, whatever the time and date", () => {
    const slot = fc.integer({ min: 0, max: (24 * 60) / TICK_MINUTES - 1 });
    const day = fc.integer({ min: 0, max: 364 });
    fc.assert(
      fc.property(slot, day, (s, d) => {
        const minutes = s * TICK_MINUTES;
        const at = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
        const job: Job = { name: "j", repo: "a/b", workflow: "w.yml", at, days: "daily", route: "actions" };
        // two days of ticks either side of the chosen date, counting starts per local date
        const start = Date.UTC(2026, 0, 1) + d * 86_400_000 - 86_400_000;
        let last: RunRecord | null = null;
        const starts = new Map<string, number>();
        for (let t = start; t < start + 3 * 86_400_000; t += TICK_MINUTES * 60_000) {
          const now = localTime(new Date(t), TZ);
          if (isDue(job, now, last)) {
            last = { date: now.date, at: "", route: "actions", ok: true, detail: "" };
            starts.set(now.date, (starts.get(now.date) ?? 0) + 1);
          }
        }
        // the middle day is fully covered, so it must have exactly one start
        const middle = localTime(new Date(start + 86_400_000 + 12 * 3_600_000), TZ).date;
        expect(starts.get(middle)).toBe(1);
        expect([...starts.values()].every((n) => n === 1)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});
