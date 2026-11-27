import { bytesToHex } from "@fleet-ops/core";
import { fakeFetch } from "@fleet-ops/core/testing";
import { beforeAll, describe, expect, it } from "vitest";
import { FLEET_COMMAND, helpText, registrationPayload } from "../src/commands";
import { fitMessage, type Handlers, handleInteraction, MESSAGE_LIMIT, registerCommands } from "../src/interactions";

let keys: CryptoKeyPair;
let publicHex: string;

beforeAll(async () => {
  keys = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  publicHex = bytesToHex(new Uint8Array((await crypto.subtle.exportKey("raw", keys.publicKey)) as ArrayBuffer));
});

async function signed(body: unknown, tamper = false): Promise<Request> {
  const raw = JSON.stringify(body);
  const ts = "1800000000";
  const sig = bytesToHex(new Uint8Array(await crypto.subtle.sign("Ed25519", keys.privateKey, new TextEncoder().encode(ts + raw))));
  return new Request("https://example.invalid/interactions", {
    method: "POST",
    headers: { "X-Signature-Ed25519": sig, "X-Signature-Timestamp": ts },
    body: tamper ? `${raw} ` : raw,
  });
}

const env = () => ({ DISCORD_PUBLIC_KEY: publicHex, DISCORD_APPLICATION_ID: "app", CHATOPS_OWNER_IDS: "owner-1, owner-2" });

function command(sub: string, options: { name: string; type: number; value: string }[] = [], user = "owner-1") {
  return { type: 2, token: "itok", member: { user: { id: user } }, data: { name: "fleet", options: [{ type: 1, name: sub, options }] } };
}

function handlers(overrides: Partial<Handlers> = {}): Handlers {
  const base = async () => "ok";
  return { help: async () => helpText(), status: base, run: base, audit: base, sweep: base, mirror: base, backup: base, ...overrides };
}

const noWait = () => {};

describe("handleInteraction", () => {
  it("refuses a request whose signature does not match with a 401", async () => {
    const res = await handleInteraction(await signed({ type: 1 }, true), env(), { handlers: handlers(), waitUntil: noWait });
    expect(res.status).toBe(401);
  });

  it("answers the PING handshake", async () => {
    const res = await handleInteraction(await signed({ type: 1 }), env(), { handlers: handlers(), waitUntil: noWait });
    expect(await res.json()).toEqual({ type: 1 });
  });

  it("refuses someone outside the allowlist without running anything", async () => {
    let ran = false;
    const res = await handleInteraction(await signed(command("audit", [], "stranger")), env(), {
      handlers: handlers({
        audit: async () => {
          ran = true;
          return "x";
        },
      }),
      waitUntil: noWait,
    });
    expect(((await res.json()) as { data: { content: string } }).data.content).toMatch(/not allowed/);
    expect(ran).toBe(false);
  });

  it("answers a read-only subcommand straight away with its options parsed", async () => {
    let seen: unknown;
    const res = await handleInteraction(await signed(command("audit", [{ name: "repos", type: 3, value: "site,docs" }])), env(), {
      handlers: handlers({
        audit: async (inv) => {
          seen = inv.options;
          return "no drift";
        },
      }),
      waitUntil: noWait,
    });
    const out = (await res.json()) as { type: number; data: { content: string; flags: number } };
    expect(out).toEqual({ type: 4, data: { content: "no drift", flags: 64 } });
    expect(seen).toEqual({ repos: "site,docs" });
  });

  it("defers a subcommand that changes something and edits the reply when it finishes", async () => {
    const f = fakeFetch([{ method: "PATCH", match: "/webhooks/app/itok/messages/@original", answer: { status: 200, json: {} } }]);
    const pending: Promise<unknown>[] = [];
    const res = await handleInteraction(await signed(command("mirror")), env(), {
      handlers: handlers({ mirror: async () => "mirrored 3 repositories" }),
      waitUntil: (p) => pending.push(p),
      fetch: f.fetch,
    });
    expect(await res.json()).toEqual({ type: 5, data: { flags: 64 } });
    await Promise.all(pending);
    expect(f.calls[0]?.body).toEqual({ content: "mirrored 3 repositories" });
  });

  it("reports a failing deferred job in the edited reply", async () => {
    const f = fakeFetch([{ method: "PATCH", match: "@original", answer: { status: 200, json: {} } }]);
    const pending: Promise<unknown>[] = [];
    await handleInteraction(await signed(command("sweep")), env(), {
      handlers: handlers({
        sweep: async () => {
          throw new Error("rate limited");
        },
      }),
      waitUntil: (p) => pending.push(p),
      fetch: f.fetch,
    });
    await Promise.all(pending);
    expect((f.calls[0]?.body as { content: string } | undefined)?.content).toBe("Failed: Error: rate limited");
  });

  it("does not run an unknown subcommand", async () => {
    const res = await handleInteraction(await signed(command("drop-tables")), env(), { handlers: handlers(), waitUntil: noWait });
    expect(((await res.json()) as { data: { content: string } }).data.content).toBe("Unknown command.");
  });
});

describe("messages and registration", () => {
  it("cuts a reply to Discord's limit", () => {
    expect(fitMessage("x".repeat(5000))).toHaveLength(MESSAGE_LIMIT);
    expect(fitMessage("short")).toBe("short");
  });

  it("registers every subcommand the router knows", () => {
    const [cmd] = registrationPayload();
    expect(cmd?.options.map((o) => o.name)).toEqual(FLEET_COMMAND.subcommands.map((s) => s.name));
    expect(cmd?.options.find((o) => o.name === "run")?.options[0]).toMatchObject({ name: "job", required: true, type: 3 });
  });

  it("lists every subcommand in help and stays within one message", () => {
    const text = helpText();
    for (const s of FLEET_COMMAND.subcommands) expect(text).toContain(`/fleet ${s.name}`);
    expect(text.length).toBeLessThan(MESSAGE_LIMIT);
  });

  it("replaces the command set with a PUT using the bot token", async () => {
    const f = fakeFetch([{ method: "PUT", match: "/applications/app/commands", answer: { status: 200, json: [] } }]);
    await registerCommands("app", "bot-token", registrationPayload(), f.fetch);
    expect(f.calls[0]?.headers.Authorization).toBe("Bot bot-token");
  });
});
