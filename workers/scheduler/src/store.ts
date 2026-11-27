// the last run of each job, one KV key per job. KV is eventually consistent, but two ticks are 15
// minutes apart, far longer than KV takes to agree with itself.

import type { RunRecord } from "./plan";

export interface RunStore {
  last(job: string): Promise<RunRecord | null>;
  save(job: string, record: RunRecord): Promise<void>;
}

export function kvStore(kv: KVNamespace): RunStore {
  return {
    async last(job) {
      return kv.get<RunRecord>(`run:${job}`, "json");
    },
    async save(job, record) {
      // a record older than 30 days is never read again, so it expires on its own
      await kv.put(`run:${job}`, JSON.stringify(record), { expirationTtl: 60 * 60 * 24 * 30 });
    },
  };
}

export function memoryStore(seed: Record<string, RunRecord> = {}): RunStore & { records: Map<string, RunRecord> } {
  const records = new Map(Object.entries(seed));
  return {
    records,
    async last(job) {
      return records.get(job) ?? null;
    },
    async save(job, record) {
      records.set(job, record);
    },
  };
}
