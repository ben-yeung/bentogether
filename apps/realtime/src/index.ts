import * as v from "valibot";
import { CLOSE, CreateBoxSchema, ID_PATTERN, randomId } from "@bentogether/shared";
import { isQuotaError, originAllowed } from "./limits";
import { devEnabled, devRoute, simulate } from "./dev";

export { Box } from "./box";

/**
 * The Worker in front of the boxes. It handles CORS and origin checks,
 * creates boxes, and hands each WebSocket to the box's Durable Object.
 * It holds no state of its own.
 *
 *   POST /api/boxes            → { id }
 *   GET  /api/boxes/:id        → box meta, or 404
 *   GET  /api/boxes/:id/ws     → WebSocket upgrade
 *   GET  /health               → ok
 *
 * Once the free plan's daily Durable Object quota is used up, calls to a box
 * throw. Those become a 503 `over_capacity` (or, for a socket, close code
 * `CLOSE.overCapacity`) that the client can explain, instead of a bare 500.
 */
export default {
  async fetch(request, env): Promise<Response> {
    const origin = request.headers.get("Origin");
    const allowed = originAllowed(origin, env.ALLOWED_ORIGINS);
    const cors = corsHeaders(allowed ? origin : null);
    try {
      return await route(request, env, allowed, cors);
    } catch (err) {
      const quota = isQuotaError(err);
      console.error(quota ? "over capacity" : "unhandled", err);
      if (request.headers.get("Upgrade") === "websocket") {
        return refuseSocket(quota ? CLOSE.overCapacity : 1011, quota ? "over_capacity" : "server_error");
      }
      return quota
        ? json({ error: "over_capacity" }, 503, { ...cors, "Retry-After": String(secondsToUtcMidnight()) })
        : json({ error: "server_error" }, 500, cors);
    }
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env, allowed: boolean, cors: HeadersInit): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (url.pathname === "/health") return new Response("ok");

  if (devEnabled(env)) {
    if (url.pathname.startsWith("/__dev/")) {
      if (!allowed) return json({ error: "forbidden_origin" }, 403, cors);
      return (await devRoute(request, env, url, cors)) ?? json({ error: "not_found" }, 404, cors);
    }
    const simulated = simulate();
    if (simulated) return simulated;
  }

  const match = /^\/api\/boxes(?:\/([^/]+)(\/ws)?)?$/.exec(url.pathname);
  if (!match) return json({ error: "not_found" }, 404, cors);
  const [, id, ws] = match;

  // Browsers always send Origin on WebSocket and cross-site fetches; a
  // missing or unknown one is either a script or another site.
  if (!allowed) return json({ error: "forbidden_origin" }, 403, cors);

  if (!id) {
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, cors);
    const ip = request.headers.get("CF-Connecting-IP") ?? "local";
    const { success } = await env.CREATE_LIMITER.limit({ key: ip });
    if (!success) return json({ error: "rate_limited" }, 429, cors);
    const body = v.safeParse(CreateBoxSchema, await request.json().catch(() => ({})));
    if (!body.success) return json({ error: "invalid" }, 400, cors);
    const boxId = randomId(10);
    const meta = await env.BOX.getByName(boxId).init({
      id: boxId,
      title: body.output.title || "Untitled bento",
      options: body.output.options,
      starter: body.output.starter,
      ...(body.output.creator ? { creator: body.output.creator } : {}),
    });
    if (!meta) return json({ error: "exists" }, 409, cors);
    return json(meta, 201, cors);
  }

  if (!ID_PATTERN.test(id)) return json({ error: "not_found" }, 404, cors);
  const stub = env.BOX.getByName(id);

  if (ws) {
    if (request.headers.get("Upgrade") !== "websocket") return json({ error: "upgrade_required" }, 426, cors);
    return stub.fetch(request);
  }

  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405, cors);
  const meta = await stub.meta();
  return meta ? json(meta, 200, cors) : json({ error: "not_found" }, 404, cors);
}

/**
 * Accepts the upgrade only to close it straight away with `code`. A failed
 * handshake reaches the browser as an opaque 1006; a close code it can read.
 */
function refuseSocket(code: number, reason: string): Response {
  const { 0: client, 1: server } = new WebSocketPair();
  server.accept();
  server.close(code, reason);
  return new Response(null, { status: 101, webSocket: client });
}

/** The free plan's daily limits reset at 00:00 UTC. */
function secondsToUtcMidnight(now = Date.now()): number {
  const d = new Date(now);
  return Math.ceil((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - now) / 1000);
}

function corsHeaders(origin: string | null): HeadersInit {
  if (!origin) return { Vary: "Origin" };
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(body: unknown, status: number, headers: HeadersInit): Response {
  return Response.json(body, { status, headers: { ...headers, "Cache-Control": "no-store" } });
}
