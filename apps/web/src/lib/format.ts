/** "5 widgets" (who's there is shown as color dots beside it). */
export function widgetsLabel(count: number): string {
  return `${count} ${count === 1 ? "widget" : "widgets"}`;
}

/**
 * Presence: "3 people viewing the bento". `includesYou` is for counts that
 * count you too (inside the box), so being alone reads "Just you…".
 */
export function viewingLabel(people: number, opts: { includesYou?: boolean } = {}): string {
  if (opts.includesYou && people <= 1) return "Just you viewing the bento";
  if (people === 0) return "Nobody's viewing the bento yet";
  return `${people} ${people === 1 ? "person" : "people"} viewing the bento`;
}

const SHORT_DATE = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const LONG_DATE = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });

/** "Nov 19", or "Nov 19, 2025" when it isn't this year. Unknown (0) shows nothing. */
export function createdLabel(at: number | undefined, now = new Date()): string | null {
  if (!at) return null;
  const d = new Date(at);
  return (d.getFullYear() === now.getFullYear() ? SHORT_DATE : LONG_DATE).format(d);
}
