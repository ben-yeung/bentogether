import { createSignal, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { NoteColor, Rect, WidgetKind } from "@bentogether/shared";
import { personColor } from "../../lib/identity";
import type { BoxSession } from "../session";
import styles from "./WidgetFrame.module.css";

export type WidgetMode = "rest" | "lifted" | "remote-lifted";

/** Pointer presses on these never start a drag or a click-to-open. */
export const INTERACTIVE =
  "button, textarea, input, select, label, a, [data-resize], [data-palette], [data-nodrag]";

/** What the board hands every widget, whatever its kind. */
export type WidgetProps = {
  id: string;
  session: BoxSession;
  rect: Rect;
  mode: WidgetMode;
  /** Pixel offset while you carry it; null when it sits in its cell. */
  carry: { x: number; y: number } | null;
  /** Color of whoever else is carrying it or working in it. */
  ringHue: number | null;
  onPointerDown: (e: PointerEvent, mode: "move" | "resize") => void;
  /**
   * Keyboard carry: shows `rect` as a preview (others make room, nothing is
   * saved) and returns it clamped to what the kind allows; null puts it down.
   */
  onKeyCarry: (rect: Rect | null, mode: "move" | "resize") => Rect | null;
  onError: (message: string) => void;
  /** After a delete went through: offers to bring it back ("Note deleted · Undo"). */
  onDeleted: (what: string) => void;
  /** A calm heads-up, not an error (say, your typing was kept to copy). */
  onNotice?: (message: string) => void;
  /** Viewers see widgets but can't move, resize or delete them. */
  readOnly: boolean;
};

/**
 * The frame every widget shares: its cell on the grid, the lift and
 * colored ring while someone carries it, delete in the corner, the resize
 * grip, and keyboard moves: Space picks it up, arrows move it (Shift+arrows
 * resize), Enter or Space puts it down and Escape cancels. Nothing moves
 * for anyone else until it's put down, so a stray arrow key does nothing.
 * What goes inside is up to the kind.
 */
export function WidgetFrame(
  props: WidgetProps & {
    kind: WidgetKind;
    color: NoteColor;
    label: string;
    /** "Delete note", "Delete to-do". */
    deleteLabel: string;
    editing?: boolean;
    /** Extra classes: one, or a list. */
    class?: string | readonly (string | undefined)[];
    style?: JSX.CSSProperties;
    /** Click on the body, or Enter on the frame. */
    onActivate?: () => void;
    /** Runs first; return true when the kind handled the key itself. */
    onKey?: (e: KeyboardEvent & { currentTarget: HTMLElement }) => boolean;
    children: JSX.Element;
  },
) {
  const s = () => props.session;
  const fail = (err: Error) => props.onError(err.message);
  /** Delete asks first: the widget and everything in it goes for everyone. */
  const [confirming, setConfirming] = createSignal(false);
  /** The owner deletes anything; editors only the widgets they added. */
  const canDelete = () => !props.readOnly && s().canDelete(props.id);
  let frame!: HTMLElement;
  /** Picked up with the keyboard: where it would land, not saved yet. */
  const [held, setHeld] = createSignal<{ rect: Rect; start: Rect } | null>(null);
  /** Read out by screen readers as you pick up, move and drop. */
  const [said, setSaid] = createSignal("");

  function putDown(commit: boolean) {
    const h = held();
    if (!h) return;
    setHeld(null);
    props.onKeyCarry(null, "move");
    const moved = !sameRect(h.rect, h.start);
    if (commit && moved) s().move(props.id, h.rect).catch(fail);
    setSaid(commit ? (moved ? "Put down." : "Put back.") : "Cancelled. It's back where it was.");
  }

  function cancelDelete() {
    setConfirming(false);
    frame.focus({ preventScroll: true });
  }

  function onKeyDown(e: KeyboardEvent & { currentTarget: HTMLElement }) {
    if (props.readOnly) return;
    if (held()) {
      // While it's held, every key is about carrying it.
      const h = held()!;
      const nudge = (dx: number, dy: number, resize: boolean) => {
        e.preventDefault();
        const r = h.rect;
        const to = resize ? { ...r, w: r.w + dx, h: r.h + dy } : { ...r, x: r.x + dx, y: r.y + dy };
        const shown = props.onKeyCarry(to, resize ? "resize" : "move");
        if (shown) {
          setHeld({ ...h, rect: shown });
          setSaid(`Column ${shown.x + 1}, row ${shown.y + 1}, ${shown.w} by ${shown.h}.`);
        }
      };
      switch (e.key) {
        case "ArrowLeft":
          return nudge(-1, 0, e.shiftKey);
        case "ArrowRight":
          return nudge(1, 0, e.shiftKey);
        case "ArrowUp":
          return nudge(0, -1, e.shiftKey);
        case "ArrowDown":
          return nudge(0, 1, e.shiftKey);
        case "Enter":
        case " ":
          e.preventDefault();
          return putDown(true);
        case "Escape":
          e.preventDefault();
          e.stopPropagation();
          return putDown(false);
        case "Tab":
          return putDown(true);
      }
      return;
    }
    if (props.onKey?.(e)) return;
    if (e.target !== e.currentTarget) return;
    switch (e.key) {
      case "Enter":
        if (!props.onActivate) return;
        e.preventDefault();
        props.onActivate();
        return;
      case " ": {
        e.preventDefault();
        const r = props.rect;
        const start = { x: r.x, y: r.y, w: r.w, h: r.h };
        props.onKeyCarry(start, "move");
        setHeld({ rect: start, start });
        setSaid("Picked up. Arrows move it, Shift and arrows resize it. Enter puts it down, Escape cancels.");
        return;
      }
      case "Delete":
      case "Backspace":
        e.preventDefault();
        if (canDelete()) setConfirming(true);
        return;
    }
  }

  return (
    <article
      ref={frame}
      data-widget={props.id}
      data-kind={props.kind}
      // Notes keep their own hook, used by tests and the cursor.
      data-note={props.kind === "note" ? props.id : undefined}
      class={[styles.frame, ...(Array.isArray(props.class) ? props.class : [props.class])]}
      data-color={props.color}
      data-mode={props.mode}
      data-editing={props.editing}
      data-carried={props.carry !== null}
      data-ringed={props.ringHue !== null}
      data-readonly={props.readOnly}
      data-confirming={confirming()}
      data-held={held() !== null}
      tabindex="0"
      aria-label={props.label}
      aria-description={
        props.readOnly ? undefined : "Press Space to move it with the arrow keys. Enter opens it."
      }
      style={{
        ...props.style,
        "--x": props.rect.x,
        "--y": props.rect.y,
        "--w": props.rect.w,
        "--h": props.rect.h,
        "--carry-x": props.carry ? `${props.carry.x}px` : undefined,
        "--carry-y": props.carry ? `${props.carry.y}px` : undefined,
        "--ring": props.ringHue !== null ? personColor(props.ringHue) : undefined,
      }}
      onPointerDown={(e) => {
        if (props.readOnly || props.editing || (e.target as Element).closest(INTERACTIVE)) return;
        props.onPointerDown(e, "move");
      }}
      onClick={(e) => {
        if (!props.onActivate || (e.target as Element).closest(INTERACTIVE)) return;
        if (e.detail > 0 && e.currentTarget.dataset.dragged === "true") return;
        props.onActivate();
      }}
      onKeyDown={onKeyDown}
      onFocusOut={(e) => {
        // Clicking or tabbing away puts it down where it is.
        if (held() && !e.currentTarget.contains(e.relatedTarget as Node | null)) putDown(true);
      }}
    >
      <span class="visually-hidden" aria-live="polite">
        {said()}
      </span>
      <Show when={canDelete()}>
        <button
          type="button"
          class={["icon-btn", styles.remove]}
          aria-label={props.deleteLabel}
          aria-haspopup="dialog"
          onClick={() => setConfirming(true)}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
          </svg>
        </button>
      </Show>

      {props.children}

      <Show when={confirming() && canDelete()}>
        <div
          class={styles.confirm}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={`${props.id}-confirm`}
          data-nodrag
          onClick={(e) => {
            if (e.target === e.currentTarget) cancelDelete();
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") {
              e.preventDefault();
              cancelDelete();
            }
          }}
        >
          <div class={styles.confirmCard}>
            <p id={`${props.id}-confirm`} class={styles.confirmTitle}>
              {props.deleteLabel}?
            </p>
            <p class={styles.confirmText}>This removes the widget and content for everyone.</p>
            <div class={styles.confirmActions}>
              <button
                type="button"
                class={styles.confirmCancel}
                ref={(el) => setTimeout(() => el.focus({ preventScroll: true }), 0)}
                onClick={cancelDelete}
              >
                Cancel
              </button>
              <button
                type="button"
                class={styles.confirmDelete}
                onClick={() => {
                  setConfirming(false);
                  const what = props.deleteLabel.replace(/^Delete /, "");
                  s()
                    .remove(props.id)
                    .then(() => props.onDeleted(what))
                    .catch(fail);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      </Show>

      <Show when={!props.readOnly}>
        <div
          class={styles.resize}
          data-resize
          aria-hidden="true"
          onPointerDown={(e) => {
            e.stopPropagation();
            props.onPointerDown(e, "resize");
          }}
        />
      </Show>
    </article>
  );
}

function sameRect(a: Rect, b: Rect) {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/** Class names for the parts kinds share: the footer row, byline and hover tools. */
export const frameParts = {
  meta: styles.meta,
  byline: styles.byline,
  typing: styles.typing,
  tools: styles.tools,
  /** Keeps the tools showing without hover. */
  toolsPinned: styles.toolsPinned,
  stat: styles.stat,
};
