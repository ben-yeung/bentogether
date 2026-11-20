import { GRID_COLS, GRID_MAX_ROWS, type Rect } from "./grid";

export type Placed = Rect & { id: string };

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function byPosition(a: Placed, b: Placed) {
  return a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Packs compartments the way food settles into a bento: nothing overlaps,
 * and everything slides up until it rests on something.
 *
 * With `gravity: false` nothing floats up; compartments only move when
 * something is dropped onto them.
 *
 * When `anchorId` is given, that compartment keeps the spot the person put
 * it in and the others make room around it, pushed down where they collide.
 * A final pass lets everything, the anchor included, settle upward, so the
 * preview while dragging and the committed result are the same layout.
 *
 * Pure and deterministic: the server and every client compute the same
 * layout from the same input, which is what lets clients preview moves
 * without waiting for the server.
 */
export function settle(
  items: readonly Placed[],
  anchorId?: string,
  opts: { gravity?: boolean } = {},
): Placed[] {
  const gravity = opts.gravity ?? true;
  const anchor = anchorId ? items.find((i) => i.id === anchorId) : undefined;
  const others = items.filter((i) => i !== anchor).sort(byPosition);

  // Pass 1: anchor first, everyone else makes room.
  const placed: Placed[] = [];
  if (anchor) placed.push({ ...anchor });
  for (const item of others) placed.push(dropInto(placed, { ...item }));

  // Pass 2: settle upward in reading order. Moving up never creates an
  // overlap with an item placed before it, so the result stays valid.
  const settled: Placed[] = [];
  // With gravity off ("free placement"), compartments stay where they're
  // put and only move when something is dropped on them.
  for (const item of placed.sort(byPosition)) settled.push(gravity ? rise(settled, { ...item }) : item);

  const byId = new Map(settled.map((p) => [p.id, p]));
  return items.map((i) => byId.get(i.id)!);
}

/** Pushes `item` down until it clears everything already placed. */
function dropInto(placed: readonly Placed[], item: Placed): Placed {
  for (;;) {
    const hits = placed.filter((p) => overlaps(p, item));
    if (hits.length === 0) return item;
    item.y = Math.max(...hits.map((h) => h.y + h.h));
  }
}

/** Raises `item` until it rests on something or the top of the box. */
function rise(placed: readonly Placed[], item: Placed): Placed {
  while (item.y > 0 && !placed.some((p) => overlaps(p, { ...item, y: item.y - 1 }))) item.y--;
  return item;
}

/** The first free cell (reading order) that fits a w×h compartment. */
export function findSpot(items: readonly Rect[], w: number, h: number): Rect {
  for (let y = 0; y < GRID_MAX_ROWS; y++) {
    for (let x = 0; x + w <= GRID_COLS; x++) {
      const r = { x, y, w, h };
      if (!items.some((i) => overlaps(i, r))) return r;
    }
  }
  return { x: 0, y: GRID_MAX_ROWS - h, w, h };
}

/** Ids whose rect differs between two layouts of the same items. */
export function changedIds(before: readonly Placed[], after: readonly Placed[]): string[] {
  const prev = new Map(before.map((p) => [p.id, p]));
  return after
    .filter((a) => {
      const b = prev.get(a.id);
      return !b || b.x !== a.x || b.y !== a.y || b.w !== a.w || b.h !== a.h;
    })
    .map((a) => a.id);
}

export function rowsUsed(items: readonly Rect[]): number {
  return items.reduce((max, i) => Math.max(max, i.y + i.h), 0);
}
