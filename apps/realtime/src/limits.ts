/**
 * Token bucket. Refills at `ratePerSec` up to `burst`; each `take` spends
 * `cost` tokens if there are enough.
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

// Per connection. Presence is chatty by design (20 Hz cursors), edits less
// so (typing patches every 80 ms), settings rarely. Each limit sits well
// above what the web client sends, so only a runaway or hostile client
// ever meets one.

/** Messages per second a connection may send, all kinds together. */
export const MESSAGE_RATE = 60;
export const MESSAGE_BURST = 120;
/** Board edits (`op`) per second. */
export const OP_RATE = 20;
export const OP_BURST = 40;
/** Rename, retitle, options, access and role changes per second. */
export const SETTINGS_RATE = 1;
export const SETTINGS_BURST = 5;
/**
 * Dropped messages a connection may rack up before it's closed. Refills, so
 * an occasional burst is forgiven but a client that keeps pushing past the
 * limits is cut off within a few seconds.
 */
export const STRIKE_RATE = 10;
export const STRIKE_BURST = 200;

/** Largest message accepted. A full note is ~2,000 characters; this leaves room for escaping. */
export const MAX_MESSAGE_BYTES = 32 * 1024;

// Per box.

/** Open sockets of any kind. Peers are capped separately; this also covers sockets that haven't said hello. */
export const MAX_SOCKETS = 40;
/** Open sockets from one address (IPv6 counted per /64). */
export const MAX_SOCKETS_PER_IP = 8;
/** A socket that hasn't said hello by now is closed. */
export const HELLO_TIMEOUT_MS = 10_000;
/** Password guesses per bento, from everyone together: 20 a minute. */
export const PASSWORD_TRY_RATE = 20 / 60;
export const PASSWORD_TRY_BURST = 20;
/** Password guesses per address (spent first): 5 a minute, room for a few typos. */
export const PASSWORD_TRY_IP_RATE = 5 / 60;
export const PASSWORD_TRY_IP_BURST = 5;
/** Owner password changes: each one costs a deliberately slow hash. */
export const PASSWORD_SET_RATE = 1 / 3;
export const PASSWORD_SET_BURST = 3;
/**
 * SQLite rows a box's flush may write per second while it's busy. Only note
 * text waits for a flush (every other change is saved as it's confirmed);
 * under heavy typing the flush writes this many and leaves the rest for the
 * next one. Once edits pause, everything left is written at once, so
 * nothing is lost before the box hibernates.
 */
export const WRITE_RATE = 5;
export const WRITE_BURST = 600;
/** How often typed note text is flushed. */
export const FLUSH_MS = 1500;
/** No messages for this long counts as idle, and the next flush writes everything. */
export const IDLE_MS = 2000;

/**
 * The key a client's address is counted under. IPv6 is cut to its /64,
 * since one connection usually holds a whole /64 and can rotate within it.
 */
export function ipKey(ip: string): string {
  if (!ip.includes(":")) return ip;
  const [head = "", tail] = ip.toLowerCase().split("::") as [string, string | undefined];
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups =
    tail === undefined
      ? left
      : [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right];
  return groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ""))
    .join(":")
    .concat("::/64");
}

/**
 * Origin allowlist with `*` wildcards, e.g. `https://*.example.com`. Keep
 * patterns narrow: anyone who can serve a page from a matching origin can
 * drive visitors' browsers at the API.
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
