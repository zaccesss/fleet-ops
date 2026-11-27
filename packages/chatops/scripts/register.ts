// registers the /fleet command with Discord from the same definitions the router uses.
// usage: DISCORD_APPLICATION_ID=... DISCORD_BOT_TOKEN=... npm run register-commands
// a global command can take up to an hour to appear in every server.

import { registerCommands, registrationPayload } from "../src/index";

const appId = process.env.DISCORD_APPLICATION_ID;
const token = process.env.DISCORD_BOT_TOKEN;
if (!appId || !token) {
  console.error("Set DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN first.");
  process.exit(1);
}

const res = await registerCommands(appId, token, registrationPayload());
if (!res.ok) {
  // Discord's error body names the field it refused; the token is never part of it
  console.error(`Discord refused the commands: HTTP ${res.status} ${(await res.text()).slice(0, 500)}`);
  process.exit(1);
}
const names = registrationPayload()[0]?.options.map((o) => o.name) ?? [];
console.log(`Registered /fleet with ${names.length} subcommands: ${names.join(", ")}`);
