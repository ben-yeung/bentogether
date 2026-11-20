import styles from "./Preview.module.css";

/** Picker tile: a small note with two lines of text. */
export function NotePreview() {
  return (
    <span class={styles.card}>
      <span />
      <span />
    </span>
  );
}
