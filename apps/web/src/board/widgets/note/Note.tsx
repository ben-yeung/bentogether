import { createEffect, createMemo, createSignal, For, Match, onSettled, Show, Switch } from "solid-js";
import { NOTE_TEXT_MAX, SYSTEM_AUTHOR, TEXT_SIZES, type TextSize } from "@bentogether/shared";
import { personVars } from "../../../lib/identity";
import {
  autoBullet,
  continueList,
  parseNote,
  type Edit,
  type Inline,
  type Line,
} from "../../../lib/markdown";
import { ColorTools } from "../../frame/ColorTools";
import { WidgetFrame, frameParts, type WidgetProps } from "../../frame/WidgetFrame";
import styles from "./Note.module.css";

const SIZE_LABEL: Record<TextSize, string> = { s: "Small", m: "Medium", l: "Large", xl: "Extra large" };
const SIZE_SHORT: Record<TextSize, string> = { s: "S", m: "M", l: "L", xl: "XL" };
/** Shown on hover; "XL" rather than "Extra large" so it fits narrow notes. */
const SIZE_SHOWN: Record<TextSize, string> = { ...SIZE_LABEL, xl: "XL" };
/** Note text size in cell units (--u), per size. S is the original. */
const FONT_SIZE: Record<TextSize, number> = { s: 15, m: 19, l: 24, xl: 31 };

/** Notes this many columns wide or narrower fold the swatches into one dot. */
const COMPACT_TOOLS_MAX_W = 2;

/**
 * One widget holding a note. Click to type (one person at a time,
 * via a lease); everyone else sees the text stream in with the typist's
 * caret in their color.
 */
export function Note(props: WidgetProps) {
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

  /**
   * Text you typed that the bento never got, kept after you lost the note so
   * nothing you wrote vanishes. Shown until you dismiss it, or until the
   * note's saved text catches up with it (a reconnect that did save it).
   */
  const [unsaved, setUnsaved] = createSignal<string | null>(null);
  const showUnsaved = () => {
    const u = unsaved();
    return u !== null && u !== s().text(props.id) ? u : null;
  };

  // Losing the note ends your edit: someone took it over after you went
  // quiet, you reconnected, the bento refused your text, or it was deleted.
  // Everything the bento confirmed is already saved; anything past that is
  // kept as a draft to copy.
  createEffect(
    () => {
      const h = holder();
      if (!editing() || (h !== null && s().isMine(h))) return null;
      return {
        draft: draft(),
        saved: s().text(props.id),
        by: h === null ? null : (s().peers[h]?.name ?? "Someone"),
      };
    },
    (lost) => {
      if (!lost) return;
      s().cancelText(props.id);
      setEditing(false);
      s().setPresence({ action: null, caret: null });
      const kept = lost.draft !== lost.saved;
      if (kept) setUnsaved(lost.draft);
      if (lost.by) {
        props.onNotice?.(
          kept
            ? `${lost.by} took over this note. Your last words didn't save; they're kept on the note.`
            : `${lost.by} took over this note while you were away. Everything you wrote is saved.`,
        );
      }
    },
  );

  async function copyUnsaved() {
    const text = unsaved();
    if (text === null) return;
    try {
      await navigator.clipboard.writeText(text);
      setUnsaved(null);
      props.onNotice?.("Copied your text.");
    } catch {
      props.onError("Couldn't copy. Select the text and copy it instead.");
    }
  }

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
    // Asked even when someone holds it: the server hands over a note whose
    // typist has gone quiet, and says no otherwise.
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

  /**
   * Replaces part of the text the way typing would, so undo still works and
   * the usual input handler sends it.
   */
  function replace(el: HTMLTextAreaElement, edit: Edit) {
    el.setSelectionRange(edit.from, edit.to);
    if (!document.execCommand("insertText", false, edit.text) && edit.text === "") {
      document.execCommand("delete");
    }
    // Chrome leaves the caret before a trailing newline after a delete.
    const caret = edit.from + edit.text.length;
    el.setSelectionRange(caret, caret);
    sendCaret();
  }

  function onInput(e: InputEvent & { currentTarget: HTMLTextAreaElement }) {
    const el = e.currentTarget;
    // "- " at the start of a line becomes a bullet.
    if (e.inputType === "insertText" && e.data === " ") {
      const edit = autoBullet(el.value, el.selectionStart);
      if (edit) {
        replace(el, edit);
        return;
      }
    }
    const text = el.value.slice(0, NOTE_TEXT_MAX);
    setDraft(text);
    s().typeText(props.id, text);
    sendCaret();
  }

  /** While typing, Escape finishes and every other key belongs to the text. */
  function onKey(e: KeyboardEvent) {
    if (!editing()) return false;
    if (e.key === "Escape") {
      e.preventDefault();
      stopEditing();
      (e.target as Element).closest<HTMLElement>("[data-note]")?.focus();
    }
    return true;
  }

  // Starter notes are signed by the box itself, shown as "bento".
  const author = createMemo(() => {
    const by = s().widget(props.id)?.createdBy ?? "";
    return by === SYSTEM_AUTHOR ? "bento" : by;
  });

  return (
    <WidgetFrame
      {...props}
      kind="note"
      class={styles.note}
      color={s().color(props.id)}
      label={`Note by ${author()}: ${s().text(props.id) || "empty"}`}
      deleteLabel="Delete note"
      editing={editing()}
      style={{ "--fs": FONT_SIZE[s().textSize(props.id)] }}
      onActivate={() => void startEditing()}
      onKey={onKey}
    >
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
            onKeyDown={(e) => {
              // Enter carries a list on, or ends it on an empty item.
              if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
              const el = e.currentTarget;
              const edit = continueList(el.value, el.selectionStart, el.selectionEnd);
              if (!edit) return;
              e.preventDefault();
              replace(el, edit);
            }}
            onSelect={sendCaret}
            onKeyUp={sendCaret}
            onPointerUp={sendCaret}
            onBlur={stopEditing}
          />
        </Show>
        <Show when={!editing() && showUnsaved()}>
          {(text) => (
            <div class={styles.unsaved} role="status" data-nodrag>
              <p class={styles.unsavedTitle}>Not saved: your last words</p>
              <p class={styles.unsavedText}>{text()}</p>
              <div class={styles.unsavedActions}>
                <button type="button" onClick={() => void copyUnsaved()}>
                  Copy
                </button>
                <button type="button" onClick={() => setUnsaved(null)}>
                  Dismiss
                </button>
              </div>
            </div>
          )}
        </Show>
      </div>

      <footer class={frameParts.meta}>
        <Show when={typist()} fallback={<span class={frameParts.byline}>by {author()}</span>}>
          {(p) => (
            <span class={frameParts.typing} style={personVars(p().hue)}>
              {p().name} is typing
            </span>
          )}
        </Show>
        <Show when={!props.readOnly}>
          <div class={frameParts.tools} data-intent="tools">
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
                <span class={styles.sizeFull}>{SIZE_SHOWN[s().textSize(props.id)]}</span>
              </span>
            </button>
            <ColorTools
              color={s().color(props.id)}
              compact={props.rect.w <= COMPACT_TOOLS_MAX_W}
              label="Note color"
              onPick={(c) =>
                s()
                  .recolor(props.id, c)
                  .catch((err: Error) => props.onError(err.message))
              }
            />
          </div>
        </Show>
      </footer>
    </WidgetFrame>
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

  // When the text outgrows the note it scrolls; mark which edges have more
  // so they fade, and keep another person's caret in view as they type.
  let el!: HTMLDivElement;
  const [more, setMore] = createSignal("");
  onSettled(() => {
    const edges = () => {
      const at = [];
      if (el.scrollTop > 1) at.push("above");
      if (el.scrollTop + el.clientHeight < el.scrollHeight - 1) at.push("below");
      setMore(at.join(" "));
    };
    const measure = () => {
      const caret = el.querySelector<HTMLElement>(`.${styles.caret}`);
      if (caret) {
        const top = caret.offsetTop;
        const bottom = top + caret.offsetHeight;
        if (top < el.scrollTop) el.scrollTop = top;
        else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
      }
      edges();
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const mo = new MutationObserver(measure);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    el.addEventListener("scroll", edges, { passive: true });
    measure();
    return () => {
      ro.disconnect();
      mo.disconnect();
      el.removeEventListener("scroll", edges);
    };
  });

  return (
    <div ref={el} class={styles.text} data-empty={props.text.length === 0} data-more={more() || undefined}>
      <Show
        when={parts()}
        fallback={
          props.text ? (
            <NoteLines text={props.text} />
          ) : (
            <span class={styles.placeholder}>{props.placeholder}</span>
          )
        }
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

/**
 * The note's text with its markdown shown: headings, lists, boxes, quotes
 * and inline styles. While someone else types it falls back to plain text,
 * so their caret lines up character for character.
 */
function NoteLines(props: { text: string }) {
  const lines = createMemo(() => parseNote(props.text));
  return (
    <For each={lines()}>
      {(line) => (
        <Switch fallback={<div class={styles.line}>{<Spans inline={line.inline} />}</div>}>
          <Match when={line.kind === "h1" || line.kind === "h2" || line.kind === "quote"}>
            <div class={[styles.line, styles[line.kind]]}>
              <Spans inline={line.inline} />
            </div>
          </Match>
          <Match when={"marker" in line && (line as Extract<Line, { marker: string }>)}>
            {(item) => (
              <div
                class={[styles.line, styles.item]}
                data-done={item().done || undefined}
                style={{ "--depth": item().depth }}
              >
                <span class={styles.marker} aria-hidden={item().kind === "bullet" ? "true" : undefined}>
                  {item().marker}
                </span>
                <span class={styles.itemText}>
                  <Spans inline={item().inline} />
                </span>
              </div>
            )}
          </Match>
        </Switch>
      )}
    </For>
  );
}

function Spans(props: { inline: Inline[] }) {
  return (
    <For each={props.inline}>
      {(p) => {
        if (typeof p === "string") return p;
        const inner = <Spans inline={p.children} />;
        if (p.style === "b") return <strong>{inner}</strong>;
        if (p.style === "i") return <em>{inner}</em>;
        if (p.style === "s") return <s>{inner}</s>;
        return <code class={styles.code}>{inner}</code>;
      }}
    </For>
  );
}
