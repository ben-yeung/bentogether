/**
 * Token bucket per connection. Presence is chatty by design (20 Hz cursor
 * updates), so the bucket allows that comfortably and stops a runaway or
 * hostile client from flooding the room or the bill.
 */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly ratePerSec: number,
    private readonly burst: number,
    now: number,
  ) {
    this.tokens = burst;
    this.last = now;
  }

  take(now: number, cost = 1): boolean {
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.ratePerSec);
    this.last = now;
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}

/** Messages per second a connection may send, all kinds together. */
export const MESSAGE_RATE = 60;
export const MESSAGE_BURST = 120;
/** Strikes (dropped messages) before the connection is closed. */
export const MAX_STRIKES = 200;

/**
 * Origin allowlist with `*` wildcards, e.g. `https://bentogether-*.vercel.app`
 * for preview deployments.
 */
export function originAllowed(origin: string | null, allowlist: string): boolean {
  if (!origin) return false;
  return allowlist
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .some((pattern) => {
      if (pattern === "*") return true;
      const re = new RegExp("^" + pattern.split("*").map(escapeRegExp).join("[a-z0-9-]*") + "$", "i");
      return re.test(origin);
    });
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * True for the errors Cloudflare throws once the free plan's daily quota is
 * used up, e.g. "Exceeded allowed volume of requests in Durable Objects free
 * tier" or "Exceeded allowed rows written in Durable Objects free tier".
 * They reset at 00:00 UTC.
 */
export function isQuotaError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /exceeded allowed|free tier|storage limit/i.test(message);
}
