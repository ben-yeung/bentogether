import { FREE_HEX, FREE_LEAD_MIN, FREE_SLOT_MIN, FREE_SLOTS } from "./protocol";

/*
 * A person's free times are one bit per half hour, as hex: slot i starts at
 * UTC minute startDay * 1440 - FREE_LEAD_MIN + 30 * i.
 */

export function slotsToBits(hex: string): boolean[] {
  const bits: boolean[] = [];
  for (let i = 0; i < FREE_HEX; i++) {
    const n = parseInt(hex[i] ?? "0", 16) || 0;
    for (let b = 3; b >= 0; b--) bits.push(((n >> b) & 1) === 1);
  }
  return bits;
}

export function bitsToSlots(bits: readonly boolean[]): string {
  let hex = "";
  for (let i = 0; i < FREE_HEX; i++) {
    let n = 0;
    for (let b = 0; b < 4; b++) n = (n << 1) | (bits[i * 4 + b] ? 1 : 0);
    hex += n.toString(16);
  }
  return hex;
}

/**
 * Moves a row when the grid's first day moves `by` slots later: what was
 * slot i is now slot i - by. Times that fall off either end are dropped.
 */
export function shiftSlots(hex: string, by: number): string {
  const bits = slotsToBits(hex);
  const next = Array.from({ length: FREE_SLOTS }, (_, i) => bits[i + by] ?? false);
  return bitsToSlots(next);
}

/** UTC minute where slot 0 starts. */
export function slotBase(startDay: number): number {
  return startDay * 1440 - FREE_LEAD_MIN;
}

/** The slot holding a UTC minute, or -1 outside the grid. */
export function slotAt(startDay: number, minute: number): number {
  const i = Math.floor((minute - slotBase(startDay)) / FREE_SLOT_MIN);
  return i >= 0 && i < FREE_SLOTS ? i : -1;
}
