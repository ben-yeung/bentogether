import { createSignal, For } from "solid-js";
import { NOTE_COLORS, type WidgetKind } from "@bentogether/shared";
import { Dialog } from "../ui/Dialog";
import type { BoxSession } from "./session";
import { WIDGET_BY_KIND, WIDGETS } from "./widgets";
import styles from "./AddWidget.module.css";

/** The picker is a 3x3 box; cells without a widget stay empty. */
const CELLS = 9;

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
  /** True until the server confirms the one you just added. */
  const [adding, setAdding] = createSignal(false);

  // A plain call, not an action: the new widget must stay mounted when
  // the server confirms it (see Pending.created in session.ts).
  function add(kind: WidgetKind) {
    setAdding(true);
    setOpen(false);
    const color = WIDGET_BY_KIND[kind].firstColor ?? NOTE_COLORS[s().ids().length % NOTE_COLORS.length]!;
    const before = new Set(s().ids());
    const saved = s().add(kind, color);
    // It shows at once; bring it into view and hand it focus, so a widget
    // that lands below the fold doesn't look like nothing happened.
    requestAnimationFrame(() => {
      const id = s()
        .ids()
        .find((i) => !before.has(i));
      const el = id ? document.querySelector<HTMLElement>(`[data-widget="${id}"]`) : null;
      if (!el) return;
      // Instant: a smooth scroll would be cut short when a note's text field takes focus.
      el.scrollIntoView({ block: "nearest" });
      el.focus({ preventScroll: true });
      el.dataset.fresh = "";
      setTimeout(() => delete el.dataset.fresh, 1400);
      // A note opens for typing straight away.
      if (kind === "note") el.click();
    });
    saved.catch((err: Error) => props.toast(err.message, "error")).finally(() => setAdding(false));
  }

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

      <Dialog
        open={open()}
        onClose={() => setOpen(false)}
        label="Add to bento"
        panelClass={styles.box}
        closeClass={styles.close}
      >
        <h2 class={styles.title}>Add to bento</h2>
        <ul class={styles.tray}>
          <For each={WIDGETS}>
            {(w, i) => (
              <li>
                <button
                  type="button"
                  class={styles.option}
                  onClick={() => void add(w.kind)}
                  autofocus={i() === 0}
                >
                  <span class={styles.preview} data-kind={w.kind} aria-hidden="true">
                    <w.Preview />
                  </span>
                  <span class={styles.optionText}>
                    <span class={styles.optionName}>{w.name}</span>
                    <span class={styles.optionBlurb}>{w.blurb}</span>
                  </span>
                </button>
              </li>
            )}
          </For>
          <For each={Array.from({ length: CELLS - WIDGETS.length })}>
            {() => <li class={styles.empty} aria-hidden="true" />}
          </For>
        </ul>
      </Dialog>
    </>
  );
}
