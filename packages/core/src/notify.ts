// posts a job result to whatever endpoint is configured. A failed notification must never fail the
// job it reports on, so this resolves to false instead of throwing.

import type { Fetch } from "./github";

export type Level = "ok" | "warn" | "fail";

export interface Notice {
  job: string;
  level: Level;
  summary: string;
  details?: string[];
}

export async function notify(url: string | undefined, notice: Notice, doFetch: Fetch = fetch): Promise<boolean> {
  if (!url) return false;
  try {
    const res = await doFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // details are capped so one huge failure list cannot be rejected for size
      body: JSON.stringify({ ...notice, details: notice.details?.slice(0, 25), at: new Date().toISOString() }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
