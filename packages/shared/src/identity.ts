/**
 * People at the table get a bento-ingredient name and a hue of their own.
 * Both are seeded once per device and kept, so you're the same person every
 * time you come back.
 */
export const INGREDIENT_NAMES = [
  "Mochi",
  "Tamago",
  "Onigiri",
  "Edamame",
  "Umeboshi",
  "Tempura",
  "Karaage",
  "Gyoza",
  "Wasabi",
  "Nori",
  "Natto",
  "Daikon",
  "Shiso",
  "Yuzu",
  "Kombu",
  "Ikura",
  "Kinpira",
  "Furikake",
  "Inari",
  "Takuan",
  "Sansho",
  "Renkon",
  "Hijiki",
  "Matcha",
] as const;

/**
 * People's colors: 18 vivid tones, 20° apart around the wheel. Hue alone
 * isn't enough to tell 18 apart, so each tone also has its own lightness
 * and chroma: yellows and limes bright, blues and indigos deep, so
 * neighbours differ in brightness as well as hue. All read with dark text.
 * Lightness is for light mode; dark mode adds a little (see personColor).
 */
export const PERSON_PALETTE = [
  { h: 10, l: 0.66, c: 0.2 }, // red
  { h: 30, l: 0.7, c: 0.19 }, // vermilion
  { h: 50, l: 0.75, c: 0.17 }, // orange
  { h: 70, l: 0.81, c: 0.16 }, // amber
  { h: 90, l: 0.87, c: 0.17 }, // yellow
  { h: 110, l: 0.86, c: 0.2 }, // chartreuse
  { h: 130, l: 0.8, c: 0.21 }, // lime
  { h: 150, l: 0.74, c: 0.19 }, // green
  { h: 170, l: 0.76, c: 0.14 }, // mint
  { h: 190, l: 0.78, c: 0.13 }, // aqua
  { h: 210, l: 0.73, c: 0.14 }, // sky
  { h: 230, l: 0.67, c: 0.16 }, // azure
  { h: 250, l: 0.6, c: 0.19 }, // blue
  { h: 270, l: 0.6, c: 0.21 }, // indigo
  { h: 290, l: 0.65, c: 0.22 }, // violet
  { h: 310, l: 0.7, c: 0.21 }, // orchid
  { h: 330, l: 0.68, c: 0.22 }, // magenta
  { h: 350, l: 0.74, c: 0.17 }, // pink
] as const;

export const PERSON_HUES: readonly number[] = PERSON_PALETTE.map((p) => p.h);

/** Two people never share a palette slot until all 18 are taken. */
export const MIN_HUE_GAP = 20;

export function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** The palette tone closest to any hue (older saved hues map onto it). */
export function personTone(hue: number): { h: number; l: number; c: number } {
  let best: (typeof PERSON_PALETTE)[number] = PERSON_PALETTE[0];
  for (const p of PERSON_PALETTE) if (hueDistance(p.h, hue) < hueDistance(best.h, hue)) best = p;
  return best;
}

/**
 * Text on a person's color: deep tones (red, azure, blue, indigo, violet,
 * magenta) take light text; the rest take dark. Decided per tone, from its
 * lightness, so every pill and avatar keeps readable contrast.
 */
export function personInk(hue: number): "light" | "dark" {
  return personTone(hue).l < 0.69 ? "light" : "dark";
}

/**
 * Keeps your palette color if nobody at the table has it. Otherwise gives
 * you the free color farthest from everyone present, so a table stays as
 * spread out as it can. With all 18 taken, you keep your own.
 */
export function separateHue(hue: number, taken: readonly number[]): number {
  const own = personTone(hue).h;
  const used = new Set(taken.map((t) => personTone(t).h));
  if (!used.has(own)) return own;
  let best = own;
  let bestGap = -1;
  for (const h of PERSON_HUES) {
    if (used.has(h)) continue;
    const gap = Math.min(...[...used].map((u) => hueDistance(u, h)));
    // Ties go to the color nearest your own pick.
    if (gap > bestGap || (gap === bestGap && hueDistance(h, own) < hueDistance(best, own))) {
      best = h;
      bestGap = gap;
    }
  }
  return best;
}

export function normalizeHue(hue: number): number {
  return Math.round(((hue % 360) + 360) % 360);
}

/** Deterministic name + hue from a 32-bit seed (mulberry32). */
export function identityFromSeed(seed: number): { name: string; hue: number } {
  const rand = mulberry32(seed);
  const name = INGREDIENT_NAMES[Math.floor(rand() * INGREDIENT_NAMES.length)]!;
  return { name, hue: PERSON_HUES[Math.floor(rand() * PERSON_HUES.length)]! };
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Random lowercase id, valid for `ID_PATTERN`. Uses Web Crypto. */
export function randomId(length = 12): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

/**
 * Who someone is in a poll, an Ideas board or a free-times grid: a hash of
 * their device id and the bento. Their votes follow them across tabs, and
 * the device id itself (which carries their role) stays private. cyrb53.
 */
export function voterKey(clientId: string, boxId: string): string {
  const str = `${clientId}:${boxId}`;
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36).padStart(4, "0");
}
