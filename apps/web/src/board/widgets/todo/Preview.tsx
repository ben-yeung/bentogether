import styles from "./Preview.module.css";

/** Picker tile: a small checklist, two rows ticked and one to go. */
export function TodoPreview() {
  return (
    <span class={styles.card}>
      <span data-done />
      <span data-done />
      <span />
    </span>
  );
}
