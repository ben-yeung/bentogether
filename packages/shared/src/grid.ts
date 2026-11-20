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

export type Rect = { x: number; y: number; w: number; h: number };

export function clampRect(rect: Rect, min = NOTE_SIZE.min, max = NOTE_SIZE.max): Rect {
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
