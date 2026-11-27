// splits a list into fixed-size groups, so one GraphQL query never asks for more nodes than GitHub
// accepts while still reading many repositories per request.
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error("chunk size must be a whole number above 0");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface Targets {
  targets: string[];
  unknown: string[];
}

// turns a command's repos and except arguments into a concrete list. Empty or "all" means every
// known repository. Names are matched without case but returned as they appear in `all`. Any
// name not recognised is returned so the reply can say so instead of silently doing nothing.
export function resolveTargets(reposArg: string | undefined, exceptArg: string | undefined, all: readonly string[]): Targets {
  const parse = (s?: string) => (s ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const byLower = new Map(all.map((n) => [n.toLowerCase(), n]));
  const except = new Set(parse(exceptArg).map((x) => x.toLowerCase()));
  const raw = parse(reposArg);
  const requested = raw.length === 0 || raw.some((r) => r.toLowerCase() === "all") ? [...all] : raw;
  const targets: string[] = [];
  const unknown: string[] = [];
  for (const name of requested) {
    const canonical = byLower.get(name.toLowerCase());
    if (!canonical) unknown.push(name);
    else if (!except.has(canonical.toLowerCase())) targets.push(canonical);
  }
  return { targets: [...new Set(targets)], unknown };
}
