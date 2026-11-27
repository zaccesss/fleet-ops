// every request a service accepts is verified here before anything else reads it.
//
// - GitHub webhooks: HMAC SHA-256 of the exact raw body, sent as "sha256=<hex>".
// - Discord interactions: Ed25519 over timestamp + body with the application's public key.
// - calls between workers: HMAC SHA-256 of "<timestamp>.<body>". The timestamp is signed too and a
//   call more than five minutes from the receiver's clock is refused, so a captured call cannot be
//   replayed later.

import { bytesToHex, hexToBytes } from "./encoding";

export const RUN_TIMESTAMP_HEADER = "X-Run-Timestamp";
export const RUN_SIGNATURE_HEADER = "X-Run-Signature";
export const RUN_SKEW_SECONDS = 300;

// a shared secret shorter than this is a setup mistake, so the route it guards counts as not configured.
export const MIN_SECRET_LENGTH = 32;

export function usableSecret(secret: string | undefined): secret is string {
  return typeof secret === "string" && secret.length >= MIN_SECRET_LENGTH;
}

// compares every character whatever the input, so the time taken says nothing about how close a guess was.
export function timingSafeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return bytesToHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message))));
}

export async function verifyGithubWebhook(secret: string | undefined, rawBody: string, header: string | null): Promise<boolean> {
  if (!usableSecret(secret) || !header) return false;
  return timingSafeEqual(header, `sha256=${await hmacSha256Hex(secret, rawBody)}`);
}

export async function verifyDiscordRequest(publicKeyHex: string, timestamp: string | null, rawBody: string, signatureHex: string | null): Promise<boolean> {
  if (!timestamp || !signatureHex) return false;
  try {
    const key = await crypto.subtle.importKey("raw", hexToBytes(publicKeyHex), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, hexToBytes(signatureHex), new TextEncoder().encode(timestamp + rawBody));
  } catch {
    // a malformed key or signature is a refusal, never a crash that could be mistaken for success
    return false;
  }
}

export async function signRun(secret: string, timestamp: string, body: string): Promise<string> {
  return `sha256=${await hmacSha256Hex(secret, `${timestamp}.${body}`)}`;
}

export async function verifyRun(
  secret: string | undefined,
  body: string,
  timestamp: string | null,
  signature: string | null,
  nowMs: number = Date.now(),
): Promise<boolean> {
  if (!usableSecret(secret) || !timestamp || !signature || !/^\d{10}$/.test(timestamp)) return false;
  if (Math.abs(Math.floor(nowMs / 1000) - Number(timestamp)) > RUN_SKEW_SECONDS) return false;
  return timingSafeEqual(signature, await signRun(secret, timestamp, body));
}

// headers for one signed call to another worker's /run route.
export async function signedRunHeaders(secret: string, body: string, nowMs: number = Date.now()): Promise<Record<string, string>> {
  const timestamp = String(Math.floor(nowMs / 1000));
  return {
    "Content-Type": "application/json",
    [RUN_TIMESTAMP_HEADER]: timestamp,
    [RUN_SIGNATURE_HEADER]: await signRun(secret, timestamp, body),
  };
}
