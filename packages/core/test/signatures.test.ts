import { describe, expect, it } from "vitest";
import { bytesToHex } from "../src/encoding";
import {
  hmacSha256Hex,
  MIN_SECRET_LENGTH,
  RUN_SIGNATURE_HEADER,
  RUN_TIMESTAMP_HEADER,
  signedRunHeaders,
  signRun,
  timingSafeEqual,
  verifyDiscordRequest,
  verifyGithubWebhook,
  verifyRun,
} from "../src/signatures";

const secret = "s".repeat(MIN_SECRET_LENGTH);

describe("hmacSha256Hex", () => {
  it("matches the RFC 4231 test case 2 vector", async () => {
    expect(await hmacSha256Hex("Jefe", "what do ya want for nothing?")).toBe("5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
  });
});

describe("timingSafeEqual", () => {
  it("is true only for identical strings", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
    expect(timingSafeEqual("", "")).toBe(true);
  });
});

describe("verifyGithubWebhook", () => {
  const body = JSON.stringify({ action: "closed", number: 7 });

  it("accepts the signature GitHub would send", async () => {
    const header = `sha256=${await hmacSha256Hex(secret, body)}`;
    expect(await verifyGithubWebhook(secret, body, header)).toBe(true);
  });

  it("refuses a changed body, a wrong secret, a missing header and a short secret", async () => {
    const header = `sha256=${await hmacSha256Hex(secret, body)}`;
    expect(await verifyGithubWebhook(secret, `${body} `, header)).toBe(false);
    expect(await verifyGithubWebhook("t".repeat(MIN_SECRET_LENGTH), body, header)).toBe(false);
    expect(await verifyGithubWebhook(secret, body, null)).toBe(false);
    expect(await verifyGithubWebhook("short", body, `sha256=${await hmacSha256Hex("short", body)}`)).toBe(false);
  });
});

describe("verifyDiscordRequest", () => {
  it("accepts a request signed by the matching key and refuses any change", async () => {
    const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const publicHex = bytesToHex(new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer));
    const ts = "1800000000";
    const body = JSON.stringify({ type: 1 });
    const sig = bytesToHex(new Uint8Array(await crypto.subtle.sign("Ed25519", pair.privateKey, new TextEncoder().encode(ts + body))));
    expect(await verifyDiscordRequest(publicHex, ts, body, sig)).toBe(true);
    expect(await verifyDiscordRequest(publicHex, "1800000001", body, sig)).toBe(false);
    expect(await verifyDiscordRequest(publicHex, ts, `${body} `, sig)).toBe(false);
    expect(await verifyDiscordRequest(publicHex, ts, body, null)).toBe(false);
    expect(await verifyDiscordRequest("not-hex", ts, body, sig)).toBe(false);
  });
});

describe("verifyRun", () => {
  const body = JSON.stringify({ job: "mirror-sweep" });
  const stamp = "1800000000";
  const now = 1800000000 * 1000;

  it("verifies its own signature and refuses any change", async () => {
    const sig = await signRun(secret, stamp, body);
    expect(await verifyRun(secret, body, stamp, sig, now)).toBe(true);
    expect(await verifyRun(secret, `${body} `, stamp, sig, now)).toBe(false);
    expect(await verifyRun(secret, body, "1800000001", sig, now)).toBe(false);
    expect(await verifyRun("t".repeat(MIN_SECRET_LENGTH), body, stamp, sig, now)).toBe(false);
  });

  it("accepts five minutes either side and refuses anything further", async () => {
    const sig = await signRun(secret, stamp, body);
    expect(await verifyRun(secret, body, stamp, sig, now + 300_000)).toBe(true);
    expect(await verifyRun(secret, body, stamp, sig, now - 300_000)).toBe(true);
    expect(await verifyRun(secret, body, stamp, sig, now + 301_000)).toBe(false);
    expect(await verifyRun(secret, body, stamp, sig, now - 301_000)).toBe(false);
  });

  it("refuses a timestamp that is not ten digits", async () => {
    expect(await verifyRun(secret, body, "1", await signRun(secret, "1", body), 1000)).toBe(false);
  });

  it("builds headers that the receiver accepts", async () => {
    const headers = await signedRunHeaders(secret, body, now);
    expect(await verifyRun(secret, body, headers[RUN_TIMESTAMP_HEADER] ?? null, headers[RUN_SIGNATURE_HEADER] ?? null, now)).toBe(true);
  });
});
