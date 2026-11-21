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
  onError: (message: string) => void;
  /** A calm heads-up, not an error (say, your typing was kept to copy). */
  onNotice?: (message: string) => void;
  /** Viewers see widgets but can't move, resize or delete them. */
  readOnly: boolean;
};

/**
 * The frame every widget shares: its cell on the grid, the lift and
 * colored ring while someone carries it, delete in the corner, the resize
 * grip, and keyboard moves (arrows), resizes (Shift+arrows) and delete.
 * What goes inside is up to the kind.
 */
export function WidgetFrame(
  props: WidgetProps & {
    kind: WidgetKind;
    color: NoteColor;
    label: string;
    /** "Delete note", "Delete list". */
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

  function cancelDelete() {
    setConfirming(false);
    frame.focus({ preventScroll: true });
  }

  function onKeyDown(e: KeyboardEvent & { currentTarget: HTMLElement }) {
    if (props.readOnly) return;
    if (props.onKey?.(e)) return;
    if (e.target !== e.currentTarget) return;
    const r = props.rect;
    const nudge = (dx: number, dy: number, resize: boolean) => {
      e.preventDefault();
      const to = resize ? { ...r, w: r.w + dx, h: r.h + dy } : { ...r, x: r.x + dx, y: r.y + dy };
      s().move(props.id, to).catch(fail);
    };
    switch (e.key) {
      case "Enter":
        if (!props.onActivate) return;
        e.preventDefault();
        props.onActivate();
        return;
      case "ArrowLeft":
        return nudge(-1, 0, e.shiftKey);
      case "ArrowRight":
        return nudge(1, 0, e.shiftKey);
      case "ArrowUp":
        return nudge(0, -1, e.shiftKey);
      case "ArrowDown":
        return nudge(0, 1, e.shiftKey);
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
      tabindex="0"
      aria-label={props.label}
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
    >
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
                  s().remove(props.id).catch(fail);
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
        >
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M9.5 1.5 1.5 9.5M9.5 5.5 5.5 9.5" />
          </svg>
        </div>
      </Show>
    </article>
  );
}

/** Class names for the parts kinds share: the footer row, byline and hover tools. */
export const frameParts = {
  meta: styles.meta,
  byline: styles.byline,
  typing: styles.typing,
  tools: styles.tools,
  /** Keeps the tools showing without hover. */
  toolsPinned: styles.toolsPinned,
};
