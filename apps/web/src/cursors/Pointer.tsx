import { Switch, Match } from "solid-js";
import styles from "./Pointer.module.css";

export type PointerVariant = "dart" | "hand" | "grab" | "ibeam" | "resize";

/**
 * Flat pointer glyphs, colored by `--c`, with the hotspot at the element's
 * origin. Same family as the kumi-agents cursors:
 * - dart: moving around, the tip
 * - hand: over something clickable, the fingertip
 * - grab: carrying a compartment, the palm
 * - ibeam: typing, the center of the beam
 * - resize: on or dragging a resize corner, the center of the arrow
 */
export function Pointer(props: { variant: PointerVariant }) {
  return (
    <Switch
      fallback={
        <svg class={styles.dart} viewBox="0 0 20 20" aria-hidden="true">
          <path d="M1.5 1.5 18.5 7.6 10.6 10.6 7.6 18.5Z" />
        </svg>
      }
    >
      <Match when={props.variant === "hand"}>
        <svg class={styles.hand} viewBox="0 0 18 22" aria-hidden="true">
          <path d="M6.3 1.2c1.2 0 2.1.9 2.1 2.1v6.1l5.5 1.1c1.5.3 2.5 1.6 2.4 3.1l-.3 4.3c-.2 1.9-1.7 3.3-3.6 3.3H8.9c-1.1 0-2.2-.5-2.9-1.4l-4.5-5.7c-.7-.9-.1-2.2 1-2.3.6 0 1.2.2 1.6.7V3.3c0-1.2.9-2.1 2.2-2.1Z" />
        </svg>
      </Match>
      <Match when={props.variant === "grab"}>
        <svg class={styles.grab} viewBox="0 0 22 20" aria-hidden="true">
          <path d="M4.2 7.4c0-1.1.9-1.9 2-1.9s2 .8 2 1.9V6.3c0-1.1.9-1.9 2-1.9s2 .8 2 1.9v.6c0-1 .9-1.8 2-1.8s1.9.8 1.9 1.8v1.3c0-.9.8-1.6 1.8-1.6s1.8.7 1.8 1.6v5.2c0 3.6-2.9 6.3-6.5 6.3h-1.6c-2.2 0-4.2-1-5.5-2.8L2.6 12.5c-.6-.9-.4-2 .4-2.5.6-.4 1.4-.3 1.9.2l-.7-2.8Z" />
        </svg>
      </Match>
      <Match when={props.variant === "ibeam"}>
        <svg class={styles.ibeam} viewBox="0 0 20 20" aria-hidden="true">
          <path d="M6.5 2.5c2 0 3.5.8 3.5 2.2v10.6c0 1.4-1.5 2.2-3.5 2.2M13.5 2.5c-2 0-3.5.8-3.5 2.2v10.6c0 1.4 1.5 2.2 3.5 2.2" />
        </svg>
      </Match>
      <Match when={props.variant === "resize"}>
        <svg class={styles.resize} viewBox="0 0 20 20" aria-hidden="true">
          <path d="M3 3 17 17M3 6.5V3h3.5M17 13.5V17h-3.5" />
        </svg>
      </Match>
    </Switch>
  );
}
