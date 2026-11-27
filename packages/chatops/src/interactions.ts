// the Discord interactions endpoint. Every request is verified before its body is parsed, the
// caller is checked against the owner allowlist and only then is a handler run.

import { type Fetch, GithubError, verifyDiscordRequest } from "@fleet-ops/core";
import { FLEET_COMMAND, type Subcommand } from "./commands";

export const MESSAGE_LIMIT = 2000;
const EPHEMERAL = 64;

export function fitMessage(content: string): string {
  return content.length <= MESSAGE_LIMIT ? content : `${content.slice(0, MESSAGE_LIMIT - 3)}...`;
}

export function describeError(err: unknown): string {
  if (err instanceof GithubError) return `${err.op} on ${err.repo}: HTTP ${err.status}\n${err.body.slice(0, 600)}`;
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const reply = (content: string) => json({ type: 4, data: { content: fitMessage(content), flags: EPHEMERAL } });

export interface Invocation {
  subcommand: Subcommand;
  options: Record<string, string | boolean>;
  userId: string;
}

// a handler returns text. A subcommand that changes something is deferred first, so a slow job never
// misses Discord's three second window. Its text then replaces the "thinking" message when done.
export type Handlers = Record<Subcommand, (inv: Invocation) => Promise<string>>;

export interface InteractionEnv {
  DISCORD_PUBLIC_KEY: string;
  DISCORD_APPLICATION_ID: string;
  CHATOPS_OWNER_IDS: string;
}

export interface Deps {
  handlers: Handlers;
  waitUntil: (p: Promise<unknown>) => void;
  fetch?: Fetch;
}

interface RawOption {
  name: string;
  type: number;
  value?: string | boolean;
  options?: RawOption[];
}

interface RawInteraction {
  type: number;
  token: string;
  member?: { user?: { id: string } };
  user?: { id: string };
  data?: { name: string; options?: RawOption[] };
}

export function owners(env: InteractionEnv): Set<string> {
  return new Set(
    env.CHATOPS_OWNER_IDS.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export function parseInvocation(i: RawInteraction): Invocation | null {
  if (i.data?.name !== FLEET_COMMAND.name) return null;
  const sub = i.data.options?.[0];
  if (sub?.type !== 1) return null;
  const spec = FLEET_COMMAND.subcommands.find((s) => s.name === sub.name);
  if (!spec) return null;
  const options: Record<string, string | boolean> = {};
  for (const o of sub.options ?? []) if (o.value !== undefined) options[o.name] = o.value;
  return { subcommand: spec.name, options, userId: i.member?.user?.id ?? i.user?.id ?? "" };
}

export async function editOriginal(appId: string, token: string, content: string, doFetch: Fetch = fetch): Promise<void> {
  await doFetch(`https://discord.com/api/v10/webhooks/${appId}/${token}/messages/@original`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: fitMessage(content) }),
  });
}

export async function handleInteraction(request: Request, env: InteractionEnv, deps: Deps): Promise<Response> {
  const body = await request.text();
  const ok = await verifyDiscordRequest(env.DISCORD_PUBLIC_KEY, request.headers.get("X-Signature-Timestamp"), body, request.headers.get("X-Signature-Ed25519"));
  // Discord sends deliberately bad signatures to check the endpoint refuses them with a 401
  if (!ok) return new Response("invalid request signature", { status: 401 });

  const interaction = JSON.parse(body) as RawInteraction;
  if (interaction.type === 1) return json({ type: 1 });
  if (interaction.type !== 2) return reply("That interaction type is not handled.");

  const inv = parseInvocation(interaction);
  if (!inv) return reply("Unknown command.");
  if (!owners(env).has(inv.userId)) return reply("You are not allowed to run fleet commands.");

  const spec = FLEET_COMMAND.subcommands.find((s) => s.name === inv.subcommand);
  const handler = deps.handlers[inv.subcommand];
  if (!spec?.changes) {
    try {
      return reply(await handler(inv));
    } catch (err) {
      return reply(`Failed: ${describeError(err)}`);
    }
  }

  const work = handler(inv)
    .then((text) => text)
    .catch((err: unknown) => `Failed: ${describeError(err)}`)
    .then((text) => editOriginal(env.DISCORD_APPLICATION_ID, interaction.token, text, deps.fetch));
  deps.waitUntil(work);
  return json({ type: 5, data: { flags: EPHEMERAL } });
}

export async function registerCommands(appId: string, botToken: string, payload: unknown, doFetch: Fetch = fetch): Promise<Response> {
  // a PUT replaces the whole global command set, so a removed subcommand disappears too
  return doFetch(`https://discord.com/api/v10/applications/${appId}/commands`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bot ${botToken}` },
    body: JSON.stringify(payload),
  });
}
