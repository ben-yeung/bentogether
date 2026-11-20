import styles from "./Preview.module.css";

/** Picker tile: a total between a − and a +. */
export function BudgetPreview() {
  return (
    <span class={styles.card}>
      <span class={styles.sign}>−</span>
      <span class={styles.amount}>$500</span>
      <span class={styles.sign}>+</span>
    </span>
  );
}
