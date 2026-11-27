// property-based tests: fast-check generates thousands of inputs, including the edge cases a
// hand-written example would miss. Any failure is shrunk to the smallest input that breaks it.

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config";
import { bytesToB64url, bytesToHex, hexToBytes } from "../src/encoding";
import { MIN_SECRET_LENGTH, RUN_SKEW_SECONDS, signRun, timingSafeEqual, verifyRun } from "../src/signatures";
import { chunk, resolveTargets } from "../src/util";

const secret = fc.string({ minLength: MIN_SECRET_LENGTH, maxLength: 64 });
const stamp = fc.integer({ min: 1_000_000_000, max: 9_999_999_999 }).map(String);

describe("signatures", () => {
  it("timingSafeEqual agrees with === for any pair of strings", () => {
    fc.assert(fc.property(fc.string(), fc.string(), (a, b) => timingSafeEqual(a, b) === (a === b)));
  });

  it("a signed call always verifies with the same secret, body and time", async () => {
    await fc.assert(
      fc.asyncProperty(secret, fc.string(), stamp, async (key, body, ts) => {
        const sig = await signRun(key, ts, body);
        return verifyRun(key, body, ts, sig, Number(ts) * 1000);
      }),
      { numRuns: 200 },
    );
  });

  it("any change to the body is refused", async () => {
    await fc.assert(
      fc.asyncProperty(secret, fc.string(), fc.string({ minLength: 1 }), stamp, async (key, body, extra, ts) => {
        const sig = await signRun(key, ts, body);
        return !(await verifyRun(key, body + extra, ts, sig, Number(ts) * 1000));
      }),
      { numRuns: 200 },
    );
  });

  it("a call outside the five minute window is refused however good its signature", async () => {
    await fc.assert(
      fc.asyncProperty(secret, stamp, fc.integer({ min: RUN_SKEW_SECONDS + 1, max: 100_000 }), fc.boolean(), async (key, ts, drift, ahead) => {
        const sig = await signRun(key, ts, "{}");
        const now = (Number(ts) + (ahead ? drift : -drift)) * 1000;
        return !(await verifyRun(key, "{}", ts, sig, now));
      }),
      { numRuns: 200 },
    );
  });
});

describe("encoding", () => {
  it("hex round-trips any bytes", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 256 }), (bytes) => {
        expect([...hexToBytes(bytesToHex(bytes))]).toEqual([...bytes]);
      }),
    );
  });

  it("base64url never contains characters that need escaping in a URL", () => {
    fc.assert(fc.property(fc.uint8Array({ maxLength: 256 }), (bytes) => /^[A-Za-z0-9_-]*$/.test(bytesToB64url(bytes))));
  });
});

describe("util", () => {
  it("chunk keeps every item in order and no chunk is larger than asked", () => {
    fc.assert(
      fc.property(fc.array(fc.integer()), fc.integer({ min: 1, max: 50 }), (items, size) => {
        const chunks = chunk(items, size);
        expect(chunks.flat()).toEqual(items);
        expect(chunks.every((c) => c.length > 0 && c.length <= size)).toBe(true);
      }),
    );
  });

  it("resolveTargets only returns known names and never one that was excepted", () => {
    const name = fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/);
    fc.assert(
      fc.property(fc.uniqueArray(name, { maxLength: 10 }), fc.array(name, { maxLength: 6 }), fc.array(name, { maxLength: 4 }), (all, asked, except) => {
        const { targets, unknown } = resolveTargets(asked.join(","), except.join(","), all);
        expect(targets.every((t) => all.includes(t) && !except.includes(t))).toBe(true);
        expect(unknown.every((u) => !all.includes(u))).toBe(true);
      }),
    );
  });
});

describe("config", () => {
  it("never throws anything but a ConfigError, whatever JSON it is given", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        try {
          parseConfig(value);
        } catch (err) {
          expect((err as Error).name).toBe("ConfigError");
        }
      }),
      { numRuns: 500 },
    );
  });
});
