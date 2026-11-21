import styles from "./Preview.module.css";

/** Picker tile: two people, one with something new. */
export function AsksPreview() {
  return (
    <span class={styles.card}>
      <span class={styles.row}>
        <span class={styles.avatar} data-unread>
          M
        </span>
        <span class={styles.line} style={{ "--w": "70%" }} />
        <span class={styles.pill}>2</span>
      </span>
      <span class={styles.row}>
        <span class={styles.avatar}>Y</span>
        <span class={styles.line} style={{ "--w": "50%" }} />
        <span class={styles.pill}>1</span>
      </span>
    </span>
  );
}
