// a scripted stand-in for fetch. Each route matches a method and a URL pattern and answers with a
// status and a JSON body. Every call is recorded so a test can check exactly what was sent. An
// unmatched call fails the test loudly instead of reaching the network.

export interface Call {
  method: string;
  url: string;
  body: unknown;
  headers: Record<string, string>;
}

type Answer = { status?: number; json?: unknown; text?: string } | ((call: Call) => { status?: number; json?: unknown; text?: string });

export interface Route {
  method?: string;
  match: string | RegExp;
  answer: Answer;
  times?: number;
}

export function fakeFetch(routes: Route[]) {
  const calls: Call[] = [];
  const used = new Map<Route, number>();
  const fn = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const method = (init.method ?? "GET").toUpperCase();
    const raw = typeof init.body === "string" ? init.body : undefined;
    let body: unknown = raw;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      // not JSON, keep the raw string
    }
    const call: Call = { method, url: input, body, headers: { ...(init.headers as Record<string, string>) } };
    calls.push(call);
    const route = routes.find((r) => {
      const hits = used.get(r) ?? 0;
      if (r.times !== undefined && hits >= r.times) return false;
      if (r.method && r.method.toUpperCase() !== method) return false;
      return typeof r.match === "string" ? input.includes(r.match) : r.match.test(input);
    });
    if (!route) throw new Error(`unexpected request: ${method} ${input}`);
    used.set(route, (used.get(route) ?? 0) + 1);
    const a = typeof route.answer === "function" ? route.answer(call) : route.answer;
    const status = a.status ?? 200;
    const payload = a.text ?? (a.json === undefined ? "" : JSON.stringify(a.json));
    return new Response(status === 204 ? null : payload, { status });
  };
  return { fetch: fn, calls };
}
