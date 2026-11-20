import styles from "./Preview.module.css";

/** Picker tile: three bars of different lengths. */
export function PollPreview() {
  return (
    <span class={styles.card}>
      <span class={styles.bar} style={{ "--w": "85%" }} />
      <span class={styles.bar} style={{ "--w": "45%" }} />
      <span class={styles.bar} style={{ "--w": "65%" }} />
    </span>
  );
}
