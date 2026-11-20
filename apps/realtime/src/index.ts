import * as v from "valibot";
import { CreateBoxSchema, ID_PATTERN, randomId } from "@bentogether/shared";
import { ipKey, originAllowed } from "./limits";

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
 */
export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const allowed = originAllowed(origin, env.ALLOWED_ORIGINS);
    const cors = corsHeaders(allowed ? origin : null);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (url.pathname === "/health") return new Response("ok");

    const match = /^\/api\/boxes(?:\/([^/]+)(\/ws)?)?$/.exec(url.pathname);
    if (!match) return json({ error: "not_found" }, 404, cors);
    const [, id, ws] = match;

    // Browsers always send Origin on WebSocket and cross-site fetches; a
    // missing or unknown one is either a script or another site.
    if (!allowed) return json({ error: "forbidden_origin" }, 403, cors);

    if (!id) {
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, cors);
      const ip = ipKey(request.headers.get("CF-Connecting-IP") ?? "local");
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
    const ip = ipKey(request.headers.get("CF-Connecting-IP") ?? "local");

    if (ws) {
      if (request.headers.get("Upgrade") !== "websocket")
        return json({ error: "upgrade_required" }, 426, cors);
      // Limits reconnect loops, which would otherwise reset every
      // per-connection limit inside the box.
      if (!(await env.CONNECT_LIMITER.limit({ key: ip })).success)
        return json({ error: "rate_limited" }, 429, cors);
      return env.BOX.getByName(id).fetch(request);
    }

    if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405, cors);
    if (!(await env.META_LIMITER.limit({ key: ip })).success)
      return json({ error: "rate_limited" }, 429, cors);
    const stub = env.BOX.getByName(id);
    const meta = await stub.meta();
    return meta ? json(meta, 200, cors) : json({ error: "not_found" }, 404, cors);
  },
} satisfies ExportedHandler<Env>;

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
