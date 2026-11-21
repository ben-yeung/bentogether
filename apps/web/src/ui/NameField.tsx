import { createSignal, For, onSettled, Show } from "solid-js";
import { NAME_MAX, PERSON_HUES, personTone } from "@bentogether/shared";
import { personVars } from "../lib/identity";
import styles from "./NameField.module.css";

/** The 18 palette colors people can pick. */
const PICKABLE_HUES = PERSON_HUES;

/**
 * "Your name" plus "your color": the name is per bento, the color is kept
 * for this device and picked from the "● Color" pill beside the field.
 */
export function NameField(props: {
  defaultName: string;
  hue: number;
  onHue: (hue: number) => void;
  autofocus?: boolean;
  /** Shown under the field, e.g. when someone here already has the name. */
  error?: string | undefined;
}) {
  // The picker stays tucked away: a small dot at the input's right edge
  // opens a compact popover of swatches.
  const [open, setOpen] = createSignal(false);
  let wrap!: HTMLSpanElement;

  onSettled(() => {
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !wrap.contains(e.target as Node)) setOpen(false);
    };
    addEventListener("pointerdown", close);
    addEventListener("keydown", close);
    return () => {
      removeEventListener("pointerdown", close);
      removeEventListener("keydown", close);
    };
  });

  return (
    <div class={styles.field}>
      <label class={styles.label} for="your-name">
        Your name <span class={styles.labelNote}>(just for this bento)</span>
      </label>
      <span class={styles.nameRow} ref={wrap}>
        <input
          id="your-name"
          name="name"
          class={["field", styles.input]}
          defaultValue={props.defaultName}
          maxlength={NAME_MAX}
          autocomplete="nickname"
          aria-label="Your name"
          aria-invalid={props.error ? "true" : "false"}
          aria-describedby={props.error ? "your-name-error" : undefined}
          autofocus={props.autofocus}
          onFocus={(e) => props.error && e.currentTarget.select()}
        />
        <button
          type="button"
          class={styles.colorBtn}
          aria-label="Your color"
          aria-expanded={open() ? "true" : "false"}
          aria-haspopup="true"
          title="Your color"
          onClick={() => setOpen((v) => !v)}
        >
          <span class={styles.colorDot} style={personVars(props.hue)} />
          <span class={styles.colorLabel}>Color</span>
        </button>
        <Show when={open()}>
          <div class={styles.popover} role="radiogroup" aria-label="Choose your color">
            <For each={PICKABLE_HUES}>
              {(hue) => (
                <button
                  type="button"
                  role="radio"
                  class={styles.swatch}
                  style={personVars(hue)}
                  aria-checked={personTone(props.hue).h === hue ? "true" : "false"}
                  aria-label={`Color ${hue}°`}
                  onClick={() => {
                    props.onHue(hue);
                    setOpen(false);
                  }}
                />
              )}
            </For>
          </div>
        </Show>
      </span>
      <Show when={props.error}>
        <span id="your-name-error" class={styles.error} role="alert">
          {props.error}
        </span>
      </Show>
    </div>
  );
}
