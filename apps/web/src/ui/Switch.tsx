import { createUniqueId } from "solid-js";
import styles from "./Switch.module.css";

/** An accessible on/off toggle with a label and a one-line hint. */
export function Switch(props: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = createUniqueId();
  return (
    <div class={styles.row}>
      <div class={styles.text}>
        <label for={id} class={styles.label}>
          {props.label}
        </label>
        <span class={styles.hint} id={`${id}-hint`}>
          {props.hint}
        </span>
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        class={styles.switch}
        aria-checked={props.checked ? "true" : "false"}
        aria-describedby={`${id}-hint`}
        disabled={props.disabled}
        onClick={() => props.onChange(!props.checked)}
      >
        <span class={styles.thumb} />
      </button>
    </div>
  );
}
