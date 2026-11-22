import {
  INGREDIENT_NAMES,
  NAME_MAX,
  identityFromSeed,
  personInk,
  personTone,
  randomId,
} from "@bentogether/shared";

const DEVICE_KEY = "bentogether.device.v1";
const NAMES_KEY = "bentogether.names.v1";
const LAST_NAME_KEY = "bentogether.lastName.v1";

/** Stable per device: lets your color stay yours across boxes. */
export type Device = { clientId: string; hue: number };
export type LocalIdentity = Device & { name: string };

/**
 * Storage can be unavailable (private windows, blocked site data), so every
 * read falls back to a fresh in-memory value and every write is best effort.
 */
export function loadDevice(): Device {
  try {
    const parsed = JSON.parse(localStorage.getItem(DEVICE_KEY) ?? "null") as Partial<Device> | null;
    if (parsed?.clientId && typeof parsed.hue === "number")
      return { clientId: parsed.clientId, hue: personTone(parsed.hue).h };
  } catch {
    // fall through
  }
  const { hue } = identityFromSeed(crypto.getRandomValues(new Uint32Array(1))[0]!);
  const fresh = { clientId: randomId(16), hue };
  try {
    localStorage.setItem(DEVICE_KEY, JSON.stringify(fresh));
  } catch {
    // Not persisted.
  }
  return fresh;
}

/** Your chosen color, kept for this device. */
export function saveHue(hue: number) {
  try {
    const device = loadDevice();
    localStorage.setItem(DEVICE_KEY, JSON.stringify({ ...device, hue }));
  } catch {
    // Not persisted; the color still applies to this visit.
  }
}

/**
 * Names are per box and temporary: chosen when you join, remembered only
 * on this device so a reload doesn't ask again, never unique or global.
 */
export function nameFor(boxId: string): string | null {
  try {
    const all = JSON.parse(localStorage.getItem(NAMES_KEY) ?? "{}") as Record<string, string>;
    return all[boxId] ?? null;
  } catch {
    return null;
  }
}

export function rememberName(boxId: string, name: string) {
  try {
    const all = JSON.parse(localStorage.getItem(NAMES_KEY) ?? "{}") as Record<string, string>;
    all[boxId] = name.slice(0, NAME_MAX);
    // Keep the map small: newest 50 boxes.
    const trimmed = Object.fromEntries(Object.entries(all).slice(-50));
    localStorage.setItem(NAMES_KEY, JSON.stringify(trimmed));
    // The next bento you make or join starts with it.
    localStorage.setItem(LAST_NAME_KEY, name.slice(0, NAME_MAX));
  } catch {
    // Not persisted; you'll be asked again next visit.
  }
}

// A name typed on one screen, handed to the next (in-app navigation only):
// leaving an invite for the home splash keeps you the same person.
let handoff: string | null = null;

export function handOffName(name: string) {
  handoff = name.trim() || null;
}

export function takeHandedOffName(): string | null {
  const name = handoff;
  handoff = null;
  return name;
}

/**
 * A friendly default, so joining is one keystroke: the name you used last
 * on this device, or a random ingredient the first time.
 */
export function suggestName(): string {
  try {
    const last = localStorage.getItem(LAST_NAME_KEY)?.trim();
    if (last) return last;
    // Before the last name was kept on its own: the newest per-bento one.
    const all = JSON.parse(localStorage.getItem(NAMES_KEY) ?? "{}") as Record<string, string>;
    const newest = Object.values(all).at(-1)?.trim();
    if (newest) return newest;
  } catch {
    // fall through
  }
  return INGREDIENT_NAMES[Math.floor(Math.random() * INGREDIENT_NAMES.length)]!;
}

/**
 * A person's color as CSS: their palette tone, a touch lighter in dark mode
 * (`--person-dl`). Any hue, including ones saved before the palette, maps
 * onto the nearest tone.
 */
export function personColor(hue: number): string {
  const t = personTone(hue);
  return `oklch(calc(${t.l} + var(--person-dl)) ${t.c} ${t.h})`;
}

const PASSWORDS_KEY = "bentogether.passwords.v1";

/**
 * Passwords for protected bentos, kept in sessionStorage: enough to survive
 * a reload or reconnect in this tab, gone when the tab closes.
 */
export function passwordFor(boxId: string): string | null {
  try {
    return (
      (JSON.parse(sessionStorage.getItem(PASSWORDS_KEY) ?? "{}") as Record<string, string>)[boxId] ?? null
    );
  } catch {
    return null;
  }
}

export function rememberPassword(boxId: string, password: string) {
  try {
    const all = JSON.parse(sessionStorage.getItem(PASSWORDS_KEY) ?? "{}") as Record<string, string>;
    all[boxId] = password;
    sessionStorage.setItem(PASSWORDS_KEY, JSON.stringify(all));
  } catch {
    // Not kept; you'll be asked again after a reload.
  }
}

/**
 * CSS variables for anything drawn in a person's color: `--c` is the color,
 * `--c-ink` the text that reads on it (white on deep tones, ink otherwise).
 */
export function personVars(hue: number): { "--c": string; "--c-ink": string } {
  return {
    "--c": personColor(hue),
    "--c-ink": personInk(hue) === "light" ? "var(--pill-ink-light)" : "var(--pill-ink)",
  };
}
