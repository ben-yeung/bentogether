import { createSignal } from "solid-js";

export type ThemePref = "system" | "light" | "dark";

const KEY = "bentogether.theme.v1";
const media = matchMedia("(prefers-color-scheme: dark)");

function read(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

/**
 * Light/dark is a personal preference, kept on this device. "system" follows
 * the OS. Applied as `data-theme` on <html>, which tokens.css keys off; an
 * inline script in index.html applies it before first paint (no flash).
 */
const initial = read();
const [pref, setPrefSignal] = createSignal<ThemePref>(initial);
const [systemDark, setSystemDark] = createSignal(media.matches);
media.addEventListener("change", () => setSystemDark(media.matches));

export const themePref = pref;

/** Whether the page is dark right now, whatever the reason. */
export const isDark = () => (pref() === "system" ? systemDark() : pref() === "dark");

export function setThemePref(next: ThemePref) {
  try {
    if (next === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {
    // Not remembered; still applies for this visit.
  }
  apply(next);
  setPrefSignal(next);
}

function apply(p: ThemePref) {
  if (p === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", p);
}

apply(initial);
