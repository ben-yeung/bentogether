const KEY = "bentogether.owner.v1";

/**
 * Owner tokens for bentos you made, by bento id. The token is the only proof
 * of ownership (the server keeps just its hash), so it stays on this device
 * and is only ever sent to the bento's own server.
 */
export function ownerTokenFor(boxId: string): string | undefined {
  try {
    return (JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, string>)[boxId];
  } catch {
    return undefined;
  }
}

export function saveOwnerToken(boxId: string, token: string) {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, string>;
    all[boxId] = token;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Not persisted: you can't rename this bento from another visit.
  }
}
