import { describe, expect, it } from "vitest";
import type { RunRecord } from "../src/plan";
import { kvStore } from "../src/store";

// the parts of KVNamespace the store uses, kept in a Map
function fakeKv() {
  const data = new Map<string, { value: string; ttl?: number }>();
  const kv = {
    data,
    async get(key: string, type: "json") {
      const hit = data.get(key);
      return hit && type === "json" ? JSON.parse(hit.value) : null;
    },
    async put(key: string, value: string, opts?: { expirationTtl?: number }) {
      data.set(key, { value, ttl: opts?.expirationTtl });
    },
  };
  return kv;
}

const record: RunRecord = { date: "2026-11-27", at: "2026-11-27T23:00:00.000Z", route: "actions", ok: true, detail: "dispatched" };

describe("kvStore", () => {
  it("saves under one key per job and reads it back", async () => {
    const kv = fakeKv();
    const store = kvStore(kv as unknown as KVNamespace);
    await store.save("backup", record);
    expect(await store.last("backup")).toEqual(record);
    expect([...kv.data.keys()]).toEqual(["run:backup"]);
  });

  it("returns null for a job that never ran", async () => {
    expect(await kvStore(fakeKv() as unknown as KVNamespace).last("never")).toBeNull();
  });

  it("lets a record expire after 30 days", async () => {
    const kv = fakeKv();
    await kvStore(kv as unknown as KVNamespace).save("backup", record);
    expect(kv.data.get("run:backup")?.ttl).toBe(60 * 60 * 24 * 30);
  });
});
