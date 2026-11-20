/*
 * Plain dates ("2026-11-20") and the viewer's local calendar. All-day
 * calendar events keep a plain date; timed ones keep UTC minutes and land
 * on whichever local day they start in.
 */

export function toDateStr(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Local midnight of a plain date. */
export function fromDateStr(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

export function addDays(s: string, n: number): string {
  const d = fromDateStr(s);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

export function addMonths(s: string, n: number): string {
  const d = fromDateStr(s);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  // Jan 31 + 1 month is the end of February, not March 3.
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return toDateStr(d);
}

/** The Sunday on or before a date. */
export function startOfWeek(s: string): string {
  return addDays(s, -fromDateStr(s).getDay());
}

/** The 42 days (6 weeks) a month view shows, starting on a Sunday. */
export function monthGrid(s: string): string[] {
  const d = fromDateStr(s);
  const first = startOfWeek(toDateStr(new Date(d.getFullYear(), d.getMonth(), 1)));
  return Array.from({ length: 42 }, (_, i) => addDays(first, i));
}

export function sameMonth(a: string, b: string): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

/** Local date a UTC minute falls on. */
export function dateOfMinute(minute: number): string {
  return toDateStr(new Date(minute * 60_000));
}

/** "14:30" (for a time input) of a UTC minute, in local time. */
export function timeOfMinute(minute: number): string {
  const d = new Date(minute * 60_000);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** UTC minute of a local date and "HH:MM". */
export function minuteOf(date: string, time: string): number {
  const [h, m] = time.split(":").map(Number);
  const d = fromDateStr(date);
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return Math.floor(d.getTime() / 60_000);
}

/** "2:30 PM" in the viewer's own format. */
export function clock(minute: number): string {
  return new Date(minute * 60_000).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
