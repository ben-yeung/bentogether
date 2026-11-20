/** "4:59", or "1:02:03" from an hour up. Rounds up, so it shows 0:00 only at the end. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/**
 * Reads a length someone typed: "25" is minutes, "1:30" minutes and
 * seconds, "1:00:00" hours too; "90s", "2h", "1h30m" also work.
 * Returns ms, or null if it isn't one.
 */
export function parseDuration(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, "");
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(Number(t) * 60_000);
  if (/^\d+(:\d{1,2}){1,2}$/.test(t)) {
    const parts = t.split(":").map(Number);
    const [h, m, s] = parts.length === 3 ? parts : [0, ...parts];
    if (m! >= 60 && parts.length === 3) return null;
    if (s! >= 60) return null;
    return ((h! * 60 + m!) * 60 + s!) * 1000;
  }
  const units = /^(?:(\d+)h)?(?:(\d+)m(?:in)?)?(?:(\d+)s)?$/.exec(t);
  if (units && units[0]) {
    const [, h = "0", m = "0", s = "0"] = units;
    return ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000;
  }
  return null;
}
