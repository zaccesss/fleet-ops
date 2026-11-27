// which jobs a tick should start.
//
// a job does not need a tick to land exactly on its time. It is due at the first tick at or after
// its local time, for up to GRACE_MINUTES, unless it already ran that local day. That one rule
// covers three real cases:
// - a tick that Cloudflare skipped or delayed: the next tick picks the job up
// - the March change, when 01:00 to 02:00 never happens: a 01:30 job runs at 02:00
// - the October change, when 01:00 to 02:00 happens twice: the second pass finds the job done

import type { Job } from "@fleet-ops/core";
import { type LocalTime, toMinutes } from "./clock";

export const TICK_MINUTES = 15;
// longer than the hour the March change skips plus one tick: a 01:00 job is first seen at 02:00
// local that day, a full 60 minutes late.
export const GRACE_MINUTES = 90;

// due by the clock alone, before any state is read. The tick only reads stored runs for jobs in
// this window, so a quiet tick costs no storage reads at all.
export function inWindow(job: Job, now: LocalTime): boolean {
  if (job.days !== "daily" && !job.days.includes(now.weekday)) return false;
  const late = now.minutes - toMinutes(job.at);
  return late >= 0 && late < GRACE_MINUTES;
}

export interface RunRecord {
  date: string;
  at: string;
  route: "containers" | "actions";
  ok: boolean;
  detail: string;
}

// a failed attempt does not count as the day's run, so the next tick in the window tries again.
export function isDue(job: Job, now: LocalTime, last: RunRecord | null): boolean {
  if (!inWindow(job, now)) return false;
  return !(last?.ok && last.date === now.date);
}

// the tick runs on a fixed grid, so a time between grid points would always start late.
export function offGrid(jobs: readonly Job[]): string[] {
  return jobs.filter((j) => toMinutes(j.at) % TICK_MINUTES !== 0).map((j) => `${j.name} at ${j.at} is not on the ${TICK_MINUTES} minute grid`);
}
