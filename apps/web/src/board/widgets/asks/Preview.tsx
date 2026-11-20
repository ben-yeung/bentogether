import styles from "./Preview.module.css";

/** Picker tile: two people, one with something new. */
export function AsksPreview() {
  return (
    <span class={styles.card}>
      <span class={styles.row}>
        <span class={styles.avatar}>M</span>
        <span class={styles.line} style={{ "--w": "70%" }} />
        <span class={styles.badge}>2</span>
      </span>
      <span class={styles.row}>
        <span class={styles.avatar}>Y</span>
        <span class={styles.line} style={{ "--w": "50%" }} />
      </span>
    </span>
  );
}
