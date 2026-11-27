// acting as the GitHub App with the least privilege each job needs.
//
// the only standing secret is the App's private key. Every token used for real work is minted per
// job, lasts an hour and carries only the permissions (and, for a webhook job, the one repository)
// that job needs, so a leaked token can do very little.

import { b64ToBytes, bytesToB64url, strToB64url } from "./encoding";
import { API, type Fetch, fetchWithRetry, GithubError, ghHeaders } from "./github";

export type Permission = "read" | "write";
export type Permissions = Partial<Record<"contents" | "pull_requests" | "issues" | "metadata" | "administration" | "actions" | "checks", Permission>>;

// a DER length: one byte under 128, otherwise a count byte then the length big-endian.
function derLength(n: number): number[] {
  if (n < 0x80) return [n];
  const bytes: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v % 256);
  return [0x80 | bytes.length, ...bytes];
}

// GitHub downloads App keys as PKCS1 and Web Crypto only imports PKCS8. PKCS8 is a fixed header
// (version 0 and the rsaEncryption algorithm) around the PKCS1 key as an octet string, so the key
// is wrapped here rather than failing at the first sign.
export function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array {
  const head = [0x02, 0x01, 0x00, 0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const octets = [0x04, ...derLength(pkcs1.length)];
  const inner = head.length + octets.length + pkcs1.length;
  return new Uint8Array([0x30, ...derLength(inner), ...head, ...octets, ...pkcs1]);
}

// both forms open with a SEQUENCE and a version INTEGER. In PKCS8 the next element is the algorithm
// SEQUENCE (0x30), in PKCS1 it is the modulus INTEGER (0x02), so the bytes say which form arrived
// whatever label the PEM carries.
export function isPkcs1(der: Uint8Array): boolean {
  if (der[0] !== 0x30 || der.length < 8) return false;
  const lenBytes = (der[1] ?? 0) & 0x80 ? (der[1] ?? 0) & 0x7f : 0;
  const version = 2 + lenBytes;
  return der[version] === 0x02 && der[version + 3] === 0x02;
}

export async function importAppKey(pem: string): Promise<CryptoKey> {
  const b64 = pem.replace(/-----(BEGIN|END) [^-]+-----/g, "").replace(/\\n/g, "").replace(/\s+/g, "");
  const raw = b64ToBytes(b64);
  const der = isPkcs1(raw) ? pkcs1ToPkcs8(raw) : raw;
  return crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

export interface AppOptions {
  appId: string;
  privateKey: string;
  fetch?: Fetch;
  now?: () => number;
}

export class GitHubApp {
  private key: Promise<CryptoKey> | null = null;
  private jwtCache: { token: string; exp: number } | null = null;
  private installations: Map<string, number> | null = null;

  constructor(private readonly opts: AppOptions) {}

  private nowSeconds(): number {
    return Math.floor((this.opts.now ?? Date.now)() / 1000);
  }

  // the JWT is kept for the life of the isolate: one run can mint several tokens and an RSA sign is
  // real CPU time. iat is backdated 30 seconds for clock skew and exp stays inside GitHub's 10 minute
  // limit. It is signed again once less than a minute remains.
  async jwt(): Promise<string> {
    const now = this.nowSeconds();
    if (this.jwtCache && this.jwtCache.exp - now > 60) return this.jwtCache.token;
    this.key ??= importAppKey(this.opts.privateKey);
    const header = strToB64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = strToB64url(JSON.stringify({ iat: now - 30, exp: now + 540, iss: this.opts.appId }));
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", await this.key, new TextEncoder().encode(`${header}.${payload}`));
    const token = `${header}.${payload}.${bytesToB64url(new Uint8Array(sig))}`;
    this.jwtCache = { token, exp: now + 540 };
    return token;
  }

  // one listing covers every account the App is installed on. Installation IDs never change, so the
  // map is read once per isolate, which saves a request on every later mint.
  async installationId(owner: string): Promise<number | null> {
    if (!this.installations) {
      const jwt = await this.jwt();
      const map = new Map<string, number>();
      for (let page = 1; ; page++) {
        const res = await fetchWithRetry(`${API}/app/installations?per_page=100&page=${page}`, { headers: ghHeaders(jwt) }, { fetch: this.opts.fetch });
        if (!res.ok) throw new GithubError("list installations", owner, res.status, await res.text());
        const rows = (await res.json()) as { id: number; account: { login: string } }[];
        for (const row of rows) map.set(row.account.login.toLowerCase(), row.id);
        if (rows.length < 100) break;
      }
      this.installations = map;
    }
    return this.installations.get(owner.toLowerCase()) ?? null;
  }

  // a token with only these permissions, limited to these repositories when given. A daily sweep
  // passes no list and gets an installation-wide token that still holds one narrow permission.
  async token(owner: string, permissions: Permissions, repos?: string[]): Promise<string> {
    const id = await this.installationId(owner);
    if (id === null) throw new GithubError("mint token", owner, 404, "the App is not installed on this account");
    const body: Record<string, unknown> = { permissions };
    if (repos) body.repositories = repos;
    const res = await fetchWithRetry(
      `${API}/app/installations/${id}/access_tokens`,
      { method: "POST", headers: { ...ghHeaders(await this.jwt()), "Content-Type": "application/json" }, body: JSON.stringify(body) },
      { fetch: this.opts.fetch },
    );
    if (!res.ok) throw new GithubError("mint token", repos?.join(",") ?? owner, res.status, await res.text());
    return ((await res.json()) as { token: string }).token;
  }
}
