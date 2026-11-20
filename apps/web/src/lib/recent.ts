const KEY = "bentogether.recent.v1";
const MAX = 24;

export type RecentBox = { id: string; title: string; visitedAt: number; createdAt?: number };

/** Boxes you've opened on this device, newest first. Best effort. */
export function loadRecent(): RecentBox[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]") as RecentBox[];
    return Array.isArray(list) ? list.slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function rememberBox(box: { id: string; title: string; createdAt: number }) {
  try {
    const list = [{ ...box, visitedAt: Date.now() }, ...loadRecent().filter((b) => b.id !== box.id)].slice(
      0,
      MAX,
    );
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Not remembered; nothing else depends on it.
  }
}

/** Fills in a creation date learned later (entries saved before dates existed). */
export function setCreatedAt(id: string, createdAt: number) {
  try {
    const list = loadRecent().map((b) => (b.id === id ? { ...b, createdAt } : b));
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Best effort.
  }
}

/** Drops a bento that no longer exists. */
export function forgetBox(id: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(loadRecent().filter((b) => b.id !== id)));
  } catch {
    // Best effort.
  }
}
