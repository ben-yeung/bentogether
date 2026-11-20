/**
 * Board geometry. Positions and sizes are in grid units, never pixels, so
 * every viewer agrees on where things are whatever their screen size.
 * Cursors use the same space with fractional values.
 */
export const GRID_COLS = 12;
/** Rows a board may grow to; keeps a runaway client from making it endless. */
export const GRID_MAX_ROWS = 200;

export const NOTE_SIZE = {
  min: { w: 2, h: 2 },
  max: { w: 6, h: 6 },
  default: { w: 3, h: 3 },
} as const;

/** Smallest, largest and starting size of each kind of widget. */
export const WIDGET_SIZE = {
  note: NOTE_SIZE,
  todo: {
    min: { w: 2, h: 3 },
    max: { w: 6, h: 8 },
    default: { w: 3, h: 4 },
  },
  budget: {
    min: { w: 2, h: 2 },
    max: { w: 6, h: 6 },
    default: { w: 3, h: 3 },
  },
  timer: {
    min: { w: 2, h: 2 },
    max: { w: 6, h: 6 },
    default: { w: 3, h: 3 },
  },
  poll: {
    min: { w: 2, h: 3 },
    max: { w: 6, h: 8 },
    default: { w: 3, h: 4 },
  },
  ideas: {
    min: { w: 2, h: 3 },
    max: { w: 6, h: 8 },
    default: { w: 3, h: 4 },
  },
  asks: {
    min: { w: 3, h: 3 },
    max: { w: 8, h: 8 },
    default: { w: 4, h: 4 },
  },
  freetimes: {
    min: { w: 4, h: 4 },
    max: { w: 12, h: 10 },
    default: { w: 6, h: 5 },
  },
  calendar: {
    min: { w: 4, h: 4 },
    max: { w: 12, h: 10 },
    default: { w: 6, h: 5 },
  },
} as const;

export type SizedKind = keyof typeof WIDGET_SIZE;

/** Clamps a rect to the size limits of one kind of widget. */
export function clampFor(kind: SizedKind, rect: Rect): Rect {
  const s = WIDGET_SIZE[kind];
  return clampRect(rect, s.min, s.max);
}

export type Rect = { x: number; y: number; w: number; h: number };

type Size = { readonly w: number; readonly h: number };

export function clampRect(rect: Rect, min: Size = NOTE_SIZE.min, max: Size = NOTE_SIZE.max): Rect {
  const w = clampInt(rect.w, min.w, Math.min(max.w, GRID_COLS));
  const h = clampInt(rect.h, min.h, max.h);
  return {
    w,
    h,
    x: clampInt(rect.x, 0, GRID_COLS - w),
    y: clampInt(rect.y, 0, GRID_MAX_ROWS - h),
  };
}

function clampInt(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, Math.round(n)));
}
