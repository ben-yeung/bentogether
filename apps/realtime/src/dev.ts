/**
 * Local-only switches for stepping through what people see when Cloudflare's
 * free quota runs out. Active only when `DEV_TOOLS` is "1", which is set in
 * the top-level vars of wrangler.jsonc (used by `wrangler dev`) and never in
 * `env.production`.
 *
 *   GET  /__dev/simulate                  → { mode }
 *   POST /__dev/simulate?mode=…           → set the mode
 *   POST /__dev/boxes/:id/cut-off         → end live sessions in a box as if
 *                                           its quota ran out (and switch the
 *                                           mode to over_capacity)
 *
 * Modes:
 *   off            normal
 *   over_capacity  every API call fails the way a used-up Durable Object
 *                  quota does (503 / socket close 4503), through the real
 *                  error handling
 *   unreachable    every API call gets a CORS-less 429 page, like the
 *                  Worker's own daily limit (Cloudflare error 1027)
 */
export const SIMULATIONS = ["off", "over_capacity", "unreachable"] as const;
export type Simulation = (typeof SIMULATIONS)[number];

// One isolate serves everything under `wrangler dev`, so module state is enough.
let mode: Simulation = "off";

export function devEnabled(env: Env): boolean {
  return env.DEV_TOOLS === "1";
}

/** Handles `/__dev/*`; returns null for any other path. */
export async function devRoute(
  request: Request,
  env: Env,
  url: URL,
  cors: HeadersInit,
): Promise<Response | null> {
  if (url.pathname === "/__dev/simulate") {
    if (request.method === "POST") {
      const next = url.searchParams.get("mode") as Simulation;
      if (!SIMULATIONS.includes(next))
        return Response.json({ error: "bad_mode" }, { status: 400, headers: cors });
      mode = next;
      console.log(`[dev] simulating: ${mode}`);
    }
    return Response.json({ mode }, { headers: cors });
  }
  const cut = /^\/__dev\/boxes\/([a-z0-9]{8,24})\/cut-off$/.exec(url.pathname);
  if (cut && request.method === "POST") {
    mode = "over_capacity";
    await env.BOX.getByName(cut[1]!).closeAllOverCapacity();
    console.log(`[dev] cut off ${cut[1]}; simulating: ${mode}`);
    return Response.json({ mode }, { headers: cors });
  }
  return null;
}

/** Applies the current simulation to a real API request, before it's handled. */
export function simulate(): Response | null {
  if (mode === "unreachable") return new Response("error code: 1027", { status: 429 });
  if (mode === "over_capacity") {
    throw new Error("Exceeded allowed volume of requests in Durable Objects free tier. (simulated)");
  }
  return null;
}
