import { For } from "solid-js";
import styles from "./Preview.module.css";

/** Picker tile: a little month with two events and today marked. */
export function CalendarPreview() {
  return (
    <span class={styles.card}>
      <span class={styles.top} />
      <For each={Array.from({ length: 14 }, (_, i) => i)}>
        {(i) => (
          <span
            class={styles.day}
            data-on={i === 4 || i === 9 ? "" : undefined}
            data-today={i === 6 ? "" : undefined}
          />
        )}
      </For>
    </span>
  );
}
