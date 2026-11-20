import { action, createOptimistic, createSignal, For } from "solid-js";
import { NOTE_COLORS } from "@bentogether/shared";
import { Dialog } from "../ui/Dialog";
import type { BoxSession } from "./session";
import styles from "./AddWidget.module.css";

/** Widgets you can add. Sticky notes today; richer compartments join this list. */
const WIDGETS = [
  {
    kind: "note",
    name: "Sticky note",
    blurb: "Text anyone in the bento can write in, live.",
  },
] as const;

/**
 * The floating "+" at the bottom right of the bento. It stays put while the
 * grid scrolls, and opens a picker of widgets to add.
 */
export function AddWidget(props: {
  session: BoxSession;
  toast: (message: string, tone?: "info" | "error") => void;
}) {
  const s = () => props.session;
  const [open, setOpen] = createSignal(false);
  // "Adding…" is an optimistic flag co-written by the action (2.0 pattern).
  const [adding, setAdding] = createOptimistic(false);

  const addNote = action(function* () {
    setAdding(true);
    setOpen(false);
    const color = NOTE_COLORS[s().ids().length % NOTE_COLORS.length]!;
    try {
      yield s().addNote(color);
    } catch (err) {
      props.toast((err as Error).message, "error");
    }
  });

  return (
    <>
      <button
        type="button"
        class={styles.fab}
        aria-label="Add to bento"
        title="Add to bento"
        aria-haspopup="dialog"
        disabled={adding()}
        onClick={() => setOpen(true)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      <Dialog open={open()} onClose={() => setOpen(false)} label="Add to bento">
        <div class={styles.picker}>
          <h2 class={styles.title}>Add to bento</h2>
          <ul class={styles.options}>
            <For each={WIDGETS}>
              {(w) => (
                <li>
                  <button type="button" class={styles.option} onClick={() => void addNote()} autofocus>
                    <span class={styles.preview} data-kind={w.kind} aria-hidden="true">
                      <span class={styles.previewNote}>
                        <span />
                        <span />
                      </span>
                    </span>
                    <span class={styles.optionText}>
                      <span class={styles.optionName}>{w.name}</span>
                      <span class={styles.optionBlurb}>{w.blurb}</span>
                    </span>
                  </button>
                </li>
              )}
            </For>
          </ul>
          <p class={styles.more}>More compartments are on the way.</p>
        </div>
      </Dialog>
    </>
  );
}
