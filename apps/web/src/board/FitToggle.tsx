import { Show } from "solid-js";
import { fitToScreen, NARROW_PX, setFitToScreen } from "../lib/fit";
import { useMedia } from "../lib/media";
import styles from "./FitToggle.module.css";

/**
 * Narrow screens only: switch between the whole bento fitted to the width
 * (pinch to zoom in) and its usual size, which scrolls sideways.
 */
export function FitToggle() {
  const narrow = useMedia(`(max-width: ${NARROW_PX - 1}px)`);
  return (
    <Show when={narrow()}>
      <button
        type="button"
        class={styles.toggle}
        title={fitToScreen() ? "Show at the usual size" : "Fit the bento to the screen"}
        onClick={() => setFitToScreen(!fitToScreen())}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <Show when={fitToScreen()} fallback={<path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4" />}>
            <path d="M7 3v4H3M13 3v4h4M17 13h-4v4M3 13h4v4" />
          </Show>
        </svg>
        {fitToScreen() ? "Actual size" : "Fit to screen"}
      </button>
    </Show>
  );
}
