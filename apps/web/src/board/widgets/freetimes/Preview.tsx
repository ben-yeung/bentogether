import { For } from "solid-js";
import styles from "./Preview.module.css";

/** Picker tile: a small grid with a darker band where people overlap. */
export function FreeTimesPreview() {
  const shades = [0, 1, 2, 1, 0, 1, 3, 2, 0, 2, 3, 1, 0, 1, 2, 0];
  return (
    <span class={styles.card}>
      <For each={shades}>{(n) => <span class={styles.cell} style={{ "--n": n / 3 }} />}</For>
    </span>
  );
}
