import type { BoxMeta, CreateBox, CreatedBox } from "@bentogether/shared";
import { REALTIME_URL } from "./config";

export class BoxNotFound extends Error {
  constructor() {
    super("This bento doesn't exist, or it was cleared away.");
    this.name = "BoxNotFound";
  }
}

/**
 * The server said its free daily capacity on Cloudflare is used up. Nothing
 * is lost; it comes back when the quota resets at 00:00 UTC.
 */
export class OverCapacity extends Error {
  constructor() {
    super("benTogether has used up its demo capacity for today.\nYour bentos are safe.");
    this.name = "OverCapacity";
  }
}

/**
 * The server couldn't be reached at all. Usually the network, but once the
 * Worker's own daily request limit is hit Cloudflare answers with a page the
 * browser isn't allowed to read, so it looks exactly like this.
 */
export class Unreachable extends Error {
  constructor() {
    super(
      "Can't reach benTogether right now. Check your connection.\nWe may have hit today's demo capacity.",
    );
    this.name = "Unreachable";
  }
}

/**
 * This tab's code and the server speak different protocol versions: we
 * shipped an update since the page loaded. Reloading fetches the new code.
 */
export class Outdated extends Error {
  constructor() {
    super("benTogether was updated since this page loaded.\nReload to get the new version.");
    this.name = "Outdated";
  }
}

/** Meta plus live counts and the colors of whoever is there right now. */
export type BoxInfo = BoxMeta & { people: number; widgetCount: number; hues?: number[] };

/** `fetch` that turns a network failure or a quota response into a typed error. */
async function call(path: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${REALTIME_URL}${path}`, init);
  } catch (err) {
    if (init?.signal?.aborted) throw err;
    throw new Unreachable();
  }
  if (res.status === 503) throw new OverCapacity();
  return res;
}

export async function createBox(input: CreateBox): Promise<CreatedBox> {
  const res = await call("/api/boxes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (res.status === 429) throw new Error("That's a lot of new bentos. Try again in a minute.");
  if (!res.ok) throw new Error("Couldn't make a bento. Try again.");
  return (await res.json()) as CreatedBox;
}

export async function getBox(id: string, signal?: AbortSignal): Promise<BoxInfo> {
  const res = await call(`/api/boxes/${encodeURIComponent(id)}`, signal ? { signal } : {});
  if (res.status === 404) throw new BoxNotFound();
  if (!res.ok) throw new Error("Couldn't reach the bento. Try again in a moment.");
  return (await res.json()) as BoxInfo;
}
