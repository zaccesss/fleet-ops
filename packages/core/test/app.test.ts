import { describe, expect, it } from "vitest";
import { GitHubApp, importAppKey, isPkcs1, pkcs1ToPkcs8 } from "../src/app";
import { b64ToBytes } from "../src/encoding";
import { fakeFetch } from "./fake-fetch";

async function testKey() {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const der = new Uint8Array((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);
  return { pem: toPem(der, "PRIVATE KEY"), der, publicKey: pair.publicKey };
}

function toPem(der: Uint8Array, label: string): string {
  const b64 = btoa(String.fromCharCode(...der));
  return `-----BEGIN ${label}-----\n${b64.match(/.{1,64}/g)?.join("\n")}\n-----END ${label}-----`;
}

function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  return b64ToBytes(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
}

describe("pkcs1ToPkcs8", () => {
  it("wraps a PKCS1 key back into the PKCS8 bytes Web Crypto exported", async () => {
    const { der } = await testKey();
    // the PKCS1 key is the octet string at the end of the PKCS8 structure (offset 26 for a 2048 bit key)
    const pkcs1 = der.slice(26);
    expect([...pkcs1ToPkcs8(pkcs1)]).toEqual([...der]);
  });

  it("tells the two forms apart from their bytes", async () => {
    const { der } = await testKey();
    expect(isPkcs1(der)).toBe(false);
    expect(isPkcs1(der.slice(26))).toBe(true);
  });

  it("imports a PKCS1 key and signs with it", async () => {
    const { der } = await testKey();
    const app = new GitHubApp({ appId: "9", privateKey: toPem(der.slice(26), "RSA PRIVATE KEY") });
    expect((await app.jwt()).split(".")).toHaveLength(3);
  });
});

describe("GitHubApp", () => {
  it("signs a JWT that verifies with the App's public key and carries the right claims", async () => {
    const { pem, publicKey } = await testKey();
    const now = 1_800_000_000_000;
    const app = new GitHubApp({ appId: "123", privateKey: pem, now: () => now });
    const jwt = await app.jwt();
    const [h, p, s] = jwt.split(".") as [string, string, string];
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, b64urlDecode(s), new TextEncoder().encode(`${h}.${p}`));
    expect(ok).toBe(true);
    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(p)));
    expect(claims).toEqual({ iat: 1_800_000_000 - 30, exp: 1_800_000_000 + 540, iss: "123" });
  });

  it("reuses the JWT until a minute before it expires", async () => {
    const { pem } = await testKey();
    let now = 1_800_000_000_000;
    const app = new GitHubApp({ appId: "1", privateKey: pem, now: () => now });
    const first = await app.jwt();
    now += 400_000;
    expect(await app.jwt()).toBe(first);
    now += 100_000;
    expect(await app.jwt()).not.toBe(first);
  });

  it("imports a key whose newlines arrived escaped, as from an environment variable", async () => {
    const { pem } = await testKey();
    await expect(importAppKey(pem.replace(/\n/g, "\\n"))).resolves.toBeDefined();
  });

  it("mints a token with only the requested permissions and repositories", async () => {
    const { pem } = await testKey();
    const f = fakeFetch([
      { match: "/app/installations?", answer: { json: [{ id: 42, account: { login: "Example-User" } }] } },
      { method: "POST", match: "/app/installations/42/access_tokens", answer: { status: 201, json: { token: "ghs_test" } } },
    ]);
    const app = new GitHubApp({ appId: "1", privateKey: pem, fetch: f.fetch });
    expect(await app.token("example-user", { contents: "write" }, ["site"])).toBe("ghs_test");
    expect(f.calls[1]?.body).toEqual({ permissions: { contents: "write" }, repositories: ["site"] });
  });

  it("reads the installation list once and refuses an account it is not installed on", async () => {
    const { pem } = await testKey();
    const f = fakeFetch([
      { match: "/app/installations?", answer: { json: [{ id: 42, account: { login: "example-user" } }] }, times: 1 },
      { method: "POST", match: "/access_tokens", answer: { status: 201, json: { token: "t" } } },
    ]);
    const app = new GitHubApp({ appId: "1", privateKey: pem, fetch: f.fetch });
    await app.token("example-user", { metadata: "read" });
    await app.token("example-user", { metadata: "read" });
    await expect(app.token("someone-else", { metadata: "read" })).rejects.toThrow(/not installed/);
    expect(f.calls.filter((c) => c.url.includes("/app/installations?"))).toHaveLength(1);
  });
});
