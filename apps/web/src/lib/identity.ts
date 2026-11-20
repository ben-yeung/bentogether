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
  } catch {
    // Not persisted; you'll be asked again next visit.
  }
}

/** A friendly default, so joining is one keystroke. */
export function suggestName(): string {
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
