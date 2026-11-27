// wall-clock time in the fleet's time zone. Intl knows the zone's rules, so the timetable is written
// in local time all year and British Summer Time needs no special case anywhere else.

import type { Weekday } from "@fleet-ops/core";

export interface LocalTime {
  // the local calendar date, YYYY-MM-DD, used to make sure a job runs once per local day
  date: string;
  weekday: Weekday;
  // minutes since local midnight
  minutes: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function localTime(at: Date, timeZone: string): LocalTime {
  const parts = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: (parts.weekday ?? "").toLowerCase().slice(0, 3) as Weekday,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
