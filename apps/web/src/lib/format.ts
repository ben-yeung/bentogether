/** "5 notes" (who's there is shown as color dots beside it). */
export function notesLabel(compartments: number): string {
  return `${compartments} ${compartments === 1 ? "note" : "notes"}`;
}

const SHORT_DATE = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const LONG_DATE = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });

/** "Nov 19", or "Nov 19, 2025" when it isn't this year. Unknown (0) shows nothing. */
export function createdLabel(at: number | undefined, now = new Date()): string | null {
  if (!at) return null;
  const d = new Date(at);
  return (d.getFullYear() === now.getFullYear() ? SHORT_DATE : LONG_DATE).format(d);
}
