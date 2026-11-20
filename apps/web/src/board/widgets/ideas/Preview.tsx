import styles from "./Preview.module.css";

/** Picker tile: two ideas with their votes. */
export function IdeasPreview() {
  return (
    <span class={styles.card}>
      <span class={styles.row}>
        <span class={styles.up} data-on>
          3
        </span>
        <span class={styles.line} style={{ "--w": "80%" }} />
      </span>
      <span class={styles.row}>
        <span class={styles.up}>1</span>
        <span class={styles.line} style={{ "--w": "55%" }} />
      </span>
    </span>
  );
}
