import { createEffect, createSignal, For, Show } from "solid-js";
import { NOTE_COLORS, type NoteColor } from "@bentogether/shared";
import styles from "./ColorTools.module.css";

const COLOR_LABEL: Record<NoteColor, string> = {
  tamago: "Tamago yellow",
  sake: "Salmon",
  edamame: "Edamame green",
  ume: "Ume pink",
  nori: "Nori blue",
  shiso: "Shiso purple",
};

/**
 * The six ingredient swatches. In a narrow widget they fold into one
 * dot showing the current color, which opens a small palette. "Narrow" is
 * decided in grid columns by the caller, so it's the same for every viewer.
 */
export function ColorTools(props: {
  color: NoteColor;
  compact: boolean;
  /** "Note color", "List color". */
  label: string;
  onPick: (color: NoteColor) => void;
}) {
  const [open, setOpen] = createSignal(false);
  let dot: HTMLButtonElement | undefined;
  createEffect(
    () => props.compact,
    (c) => {
      if (!c) setOpen(false);
    },
  );

  function swatch(c: NoteColor, inPalette = false) {
    return (
      <button
        type="button"
        class={styles.swatch}
        data-swatch={c}
        aria-label={`Color: ${COLOR_LABEL[c]}`}
        aria-pressed={props.color === c ? "true" : "false"}
        onClick={() => {
          if (inPalette) {
            setOpen(false);
            dot?.focus();
          }
          props.onPick(c);
        }}
      />
    );
  }

  return (
    <span
      class={styles.group}
      onFocusOut={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open()) {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          dot?.focus();
        }
      }}
    >
      <Show when={props.compact} fallback={<For each={NOTE_COLORS}>{(c) => swatch(c)}</For>}>
        <button
          ref={dot}
          type="button"
          class={styles.swatch}
          data-swatch={props.color}
          data-dot
          aria-label={`Color: ${COLOR_LABEL[props.color]}. Change`}
          aria-haspopup="true"
          aria-expanded={open() ? "true" : "false"}
          title="Color"
          onClick={() => setOpen((o) => !o)}
        />
        <Show when={open()}>
          <div class={styles.palette} data-palette role="group" aria-label={props.label}>
            <For each={NOTE_COLORS}>{(c) => swatch(c, true)}</For>
          </div>
        </Show>
      </Show>
    </span>
  );
}
