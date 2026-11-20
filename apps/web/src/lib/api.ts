import type { BoxMeta, CreateBox, CreatedBox } from "@bentogether/shared";
import { REALTIME_URL } from "./config";

export class BoxNotFound extends Error {
  constructor() {
    super("This bento doesn't exist, or it was cleared away.");
    this.name = "BoxNotFound";
  }
}

/** Meta plus live counts and the colors of whoever is there right now. */
export type BoxInfo = BoxMeta & { people: number; compartments: number; hues?: number[] };

export async function createBox(input: CreateBox): Promise<CreatedBox> {
  const res = await fetch(`${REALTIME_URL}/api/boxes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (res.status === 429) throw new Error("That's a lot of new bentos. Try again in a minute.");
  if (!res.ok) throw new Error("Couldn't make a bento. Try again.");
  return (await res.json()) as CreatedBox;
}

export async function getBox(id: string, signal?: AbortSignal): Promise<BoxInfo> {
  const res = await fetch(`${REALTIME_URL}/api/boxes/${encodeURIComponent(id)}`, signal ? { signal } : {});
  if (res.status === 404) throw new BoxNotFound();
  if (!res.ok) throw new Error("Couldn't reach the bento. Check your connection.");
  return (await res.json()) as BoxInfo;
}
