import styles from "./Preview.module.css";

/** Picker tile: a time over a play button. */
export function TimerPreview() {
  return (
    <span class={styles.card}>
      <span class={styles.time}>5:00</span>
      <span class={styles.play} aria-hidden="true" />
    </span>
  );
}
