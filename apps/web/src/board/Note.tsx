import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import {
  NOTE_COLORS,
  NOTE_TEXT_MAX,
  SYSTEM_AUTHOR,
  TEXT_SIZES,
  type NoteColor,
  type Rect,
  type TextSize,
} from "@bentogether/shared";
import { personColor, personVars } from "../lib/identity";
import type { BoxSession } from "./session";
import styles from "./Note.module.css";

const SIZE_LABEL: Record<TextSize, string> = { s: "Small", m: "Medium", l: "Large", xl: "Extra large" };
const SIZE_SHORT: Record<TextSize, string> = { s: "S", m: "M", l: "L", xl: "XL" };

export type NoteMode = "rest" | "lifted" | "remote-lifted";

const COLOR_LABEL: Record<NoteColor, string> = {
  tamago: "Tamago yellow",
  sake: "Salmon",
  edamame: "Edamame green",
  ume: "Ume pink",
  nori: "Nori blue",
  shiso: "Shiso purple",
};

/**
 * One compartment holding a note. Click to type (one person at a time,
 * via a lease); everyone else sees the text stream in with the typist's
 * caret in their color.
 */
export function Note(props: {
  id: string;
  session: BoxSession;
  rect: Rect;
  mode: NoteMode;
  /** Pixel offset while you carry it; null when it sits in its cell. */
  carry: { x: number; y: number } | null;
  /** Color of whoever else is carrying or typing in it. */
  ringHue: number | null;
  onPointerDown: (e: PointerEvent, mode: "move" | "resize") => void;
  onError: (message: string) => void;
  /** Viewers see notes but can't type in, move, recolor or delete them. */
  readOnly: boolean;
}) {
  const s = () => props.session;
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal("");
  let textarea: HTMLTextAreaElement | undefined;

  const holder = createMemo(() => s().leases[props.id] ?? null);
  const typist = createMemo(() => {
    const sid = holder();
    return sid && !s().isMine(sid) ? (s().peers[sid] ?? null) : null;
  });
  const remoteCaret = createMemo(() => {
    const p = typist();
    const c = p?.presence.caret;
    return p && c && c.id === props.id ? { ...c, hue: p.hue, name: p.name } : null;
  });

  // Losing the lease (reconnect, someone deleted the note) ends your edit.
  createEffect(
    () => editing() && holder() !== null && !s().isMine(holder()!),
    (lost) => {
      if (lost) setEditing(false);
    },
  );

  // Focus once the textarea exists.
  createEffect(
    () => editing(),
    (on) => {
      if (on && textarea) {
        textarea.focus();
        const end = textarea.value.length;
        textarea.setSelectionRange(end, end);
      }
    },
  );

  async function startEditing() {
    if (editing() || props.readOnly) return;
    const busy = typist();
    if (busy) {
      props.onError(`${busy.name} is typing here.`);
      return;
    }
    const granted = await s().takeLease(props.id);
    if (!granted) {
      props.onError(typist() ? `${typist()!.name} is typing here.` : "Couldn't open this note.");
      return;
    }
    setDraft(s().text(props.id));
    setEditing(true);
    s().setPresence({ action: "typing" });
  }

  function stopEditing() {
    if (!editing()) return;
    setEditing(false);
    s().releaseLease(props.id);
    s().setPresence({ action: null, caret: null });
  }

  function sendCaret() {
    if (!textarea) return;
    s().setPresence({
      caret: { id: props.id, start: textarea.selectionStart, end: textarea.selectionEnd },
    });
  }

  function onInput(e: InputEvent & { currentTarget: HTMLTextAreaElement }) {
    const text = e.currentTarget.value.slice(0, NOTE_TEXT_MAX);
    setDraft(text);
    s().typeText(props.id, text);
    sendCaret();
  }

  function onKeyDown(e: KeyboardEvent & { currentTarget: HTMLElement }) {
    if (props.readOnly) return;
    if (editing()) {
      if (e.key === "Escape") {
        e.preventDefault();
        stopEditing();
        e.currentTarget.closest<HTMLElement>("[data-note]")?.focus();
      }
      return;
    }
    if (e.target !== e.currentTarget) return;
    const r = props.rect;
    const nudge = (dx: number, dy: number, resize: boolean) => {
      e.preventDefault();
      const to = resize ? { ...r, w: r.w + dx, h: r.h + dy } : { ...r, x: r.x + dx, y: r.y + dy };
      s()
        .moveNote(props.id, to)
        .catch((err: Error) => props.onError(err.message));
    };
    switch (e.key) {
      case "Enter":
        e.preventDefault();
        void startEditing();
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
        s()
          .remove(props.id)
          .catch((err: Error) => props.onError(err.message));
        return;
    }
  }

  // Starter notes are signed by the box itself, shown as "bento".
  const author = createMemo(() => {
    const by = s().widget(props.id)?.createdBy ?? "";
    return by === SYSTEM_AUTHOR ? "bento" : by;
  });

  return (
    <article
      data-note={props.id}
      class={styles.note}
      data-color={s().color(props.id)}
      data-size={s().textSize(props.id)}
      data-mode={props.mode}
      data-editing={editing()}
      data-carried={props.carry !== null}
      tabindex="0"
      aria-label={`Note by ${author()}: ${s().text(props.id) || "empty"}`}
      style={{
        "--x": props.rect.x,
        "--y": props.rect.y,
        "--w": props.rect.w,
        "--h": props.rect.h,
        "--carry-x": props.carry ? `${props.carry.x}px` : undefined,
        "--carry-y": props.carry ? `${props.carry.y}px` : undefined,
        "--ring": props.ringHue !== null ? personColor(props.ringHue) : undefined,
      }}
      data-readonly={props.readOnly}
      onPointerDown={(e) => {
        if (props.readOnly || editing() || (e.target as Element).closest("button, textarea, [data-resize]"))
          return;
        props.onPointerDown(e, "move");
      }}
      onClick={(e) => {
        if ((e.target as Element).closest("button, textarea, [data-resize]")) return;
        if (e.detail > 0 && e.currentTarget.dataset.dragged === "true") return;
        void startEditing();
      }}
      onKeyDown={onKeyDown}
    >
      <Show when={!props.readOnly}>
        <button
          type="button"
          class={["icon-btn", styles.remove]}
          aria-label="Delete note"
          onClick={() =>
            s()
              .remove(props.id)
              .catch((err: Error) => props.onError(err.message))
          }
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
          </svg>
        </button>
      </Show>

      <div class={styles.body}>
        <Show
          when={editing()}
          fallback={
            <NoteText
              text={s().text(props.id)}
              caret={remoteCaret()}
              placeholder={typist() ? "" : "Click to write…"}
            />
          }
        >
          <textarea
            ref={textarea}
            class={styles.input}
            value={draft()}
            maxlength={NOTE_TEXT_MAX}
            aria-label="Note text"
            onInput={onInput}
            onSelect={sendCaret}
            onKeyUp={sendCaret}
            onPointerUp={sendCaret}
            onBlur={stopEditing}
            onKeyDown={onKeyDown}
          />
        </Show>
      </div>

      <footer class={styles.meta}>
        <Show when={typist()} fallback={<span class={styles.byline}>by {author()}</span>}>
          {(p) => (
            <span class={styles.typing} style={personVars(p().hue)}>
              {p().name} is typing
            </span>
          )}
        </Show>
        <Show when={!props.readOnly}>
          <div class={styles.tools} data-intent="tools">
            <For each={NOTE_COLORS}>
              {(c) => (
                <button
                  type="button"
                  class={styles.swatch}
                  data-swatch={c}
                  aria-label={`Color: ${COLOR_LABEL[c]}`}
                  aria-pressed={s().color(props.id) === c ? "true" : "false"}
                  onClick={() =>
                    s()
                      .recolor(props.id, c)
                      .catch((err: Error) => props.onError(err.message))
                  }
                />
              )}
            </For>
            <button
              type="button"
              class={styles.sizeBtn}
              aria-label={`Text size: ${SIZE_LABEL[s().textSize(props.id)]}. Change`}
              title="Text size"
              onClick={() => {
                const cur = TEXT_SIZES.indexOf(s().textSize(props.id));
                const next = TEXT_SIZES[(cur + 1) % TEXT_SIZES.length]!;
                s()
                  .resizeText(props.id, next)
                  .catch((err: Error) => props.onError(err.message));
              }}
            >
              <span aria-hidden="true">Aa</span>
              <span class={styles.sizeTag} aria-hidden="true">
                <span class={styles.sizeShort}>{SIZE_SHORT[s().textSize(props.id)]}</span>
                <span class={styles.sizeFull}>{SIZE_LABEL[s().textSize(props.id)]}</span>
              </span>
            </button>
          </div>
        </Show>
      </footer>

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

/**
 * Read-only text, with another person's caret and selection drawn in their
 * color. Uses the same typography as the textarea, so text doesn't shift
 * when you start typing.
 */
function NoteText(props: {
  text: string;
  placeholder: string;
  caret: { start: number; end: number; hue: number; name: string } | null;
}) {
  const parts = createMemo(() => {
    const c = props.caret;
    const t = props.text;
    if (!c) return null;
    const a = Math.min(c.start, c.end, t.length);
    const b = Math.min(Math.max(c.start, c.end), t.length);
    return { before: t.slice(0, a), sel: t.slice(a, b), after: t.slice(b) };
  });
  return (
    <div class={styles.text} data-empty={props.text.length === 0}>
      <Show
        when={parts()}
        fallback={props.text || <span class={styles.placeholder}>{props.placeholder}</span>}
      >
        {(p) => (
          <>
            {p().before}
            <mark class={styles.selection} style={personVars(props.caret!.hue)}>
              {p().sel}
            </mark>
            <span class={styles.caret} style={personVars(props.caret!.hue)} aria-hidden="true">
              <span class={styles.flag}>{props.caret!.name}</span>
            </span>
            {p().after}
          </>
        )}
      </Show>
    </div>
  );
}
