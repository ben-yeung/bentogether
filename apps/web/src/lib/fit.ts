import { createSignal } from "solid-js";

const KEY = "bentogether.fit.v1";

/** Below this width the bento can't show at its usual size. */
export const NARROW_PX = 900;

function read(): boolean {
  try {
    // Fit unless you've asked for the usual size.
    return localStorage.getItem(KEY) !== "actual";
  } catch {
    return true;
  }
}

/**
 * On a narrow screen the bento either fits the width (smaller, all of it in
 * view; pinch to zoom) or keeps its usual size and scrolls sideways. The
 * layout is the same either way: only the scale changes. Kept on this device.
 */
const [fit, setFitSignal] = createSignal(read());

export const fitToScreen = fit;

export function setFitToScreen(next: boolean) {
  try {
    if (next) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, "actual");
  } catch {
    // Not remembered; still applies for this visit.
  }
  setFitSignal(next);
}
