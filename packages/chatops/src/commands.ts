// the one /fleet command and its subcommands. The router and the registration payload are both built
// from this list, so a subcommand cannot exist in one place and be missing from the other.

export type OptionType = "string" | "boolean";

export interface OptionSpec {
  name: string;
  description: string;
  type: OptionType;
  required?: boolean;
  choices?: string[];
}

export interface SubcommandSpec {
  name: Subcommand;
  description: string;
  options: OptionSpec[];
  // a subcommand that changes something is deferred and confirmed once it has run
  changes: boolean;
}

export type Subcommand = "help" | "status" | "run" | "audit" | "sweep" | "mirror" | "backup";

const repos: OptionSpec = { name: "repos", description: "Comma separated repository names (all for every one)", type: "string" };
const except: OptionSpec = { name: "except", description: "Comma separated repository names to leave out", type: "string" };

export const FLEET_COMMAND: { name: string; description: string; subcommands: SubcommandSpec[] } = {
  name: "fleet",
  description: "Operate the repository fleet",
  subcommands: [
    { name: "help", description: "What each subcommand does", options: [], changes: false },
    { name: "status", description: "The last run of every scheduled job", options: [], changes: false },
    {
      name: "run",
      description: "Start one scheduled job now",
      options: [{ name: "job", description: "The job name from fleet.json", type: "string", required: true }],
      changes: true,
    },
    { name: "audit", description: "Report settings drift without changing anything", options: [repos, except], changes: false },
    { name: "sweep", description: "Run the daily governance sweep now", options: [repos, except], changes: true },
    { name: "mirror", description: "Mirror to GitLab now", options: [repos, except], changes: true },
    { name: "backup", description: "Back up issues, pull requests and releases now", options: [repos, except], changes: true },
  ],
};

// Discord's application command types: 1 is a slash command, 1 inside it is a subcommand, then 3 is
// a string option and 5 a boolean.
const OPTION_TYPE: Record<OptionType, number> = { string: 3, boolean: 5 };

export function registrationPayload() {
  return [
    {
      name: FLEET_COMMAND.name,
      description: FLEET_COMMAND.description,
      type: 1,
      // nobody but the server's administrators sees the command by default; the allowlist still applies
      default_member_permissions: "8",
      options: FLEET_COMMAND.subcommands.map((s) => ({
        type: 1,
        name: s.name,
        description: s.description,
        options: s.options.map((o) => ({
          type: OPTION_TYPE[o.type],
          name: o.name,
          description: o.description,
          required: o.required ?? false,
          ...(o.choices ? { choices: o.choices.map((c) => ({ name: c, value: c })) } : {}),
        })),
      })),
    },
  ];
}

export function helpText(): string {
  const lines = FLEET_COMMAND.subcommands.map((s) => {
    const opts = s.options.map((o) => (o.required ? `<${o.name}>` : `[${o.name}]`)).join(" ");
    return `\`/fleet ${s.name}${opts ? ` ${opts}` : ""}\`: ${s.description}`;
  });
  return ["**fleet commands**", ...lines, "", "Leave `repos` empty or use `all` for every repository. `except` leaves some out."].join("\n");
}
