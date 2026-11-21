import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  onCleanup,
  onSettled,
  Show,
  Switch,
} from "solid-js";
import {
  NOTE_TEXT_MAX,
  SYSTEM_AUTHOR,
  TEXT_SIZES,
  applyText,
  composeText,
  diffText,
  transformIndex,
  transformText,
  type Peer,
  type TextOp,
  type TextSize,
} from "@bentogether/shared";
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

/** Someone else's caret and selection in a note, in their color. */
type Caret = { sid: string; start: number; end: number; hue: number; name: string };

/** "Mochi", "Mochi and Nori", "3 people". */
function names(people: Peer[]): string {
  if (people.length <= 2) return people.map((p) => p.name).join(" and ");
  return `${people.length} people`;
}

/**
 * One widget holding a note. Click to type; anyone can type at once, and
 * everyone sees the others' text stream in with their carets in their
 * colors. Edits are merged by the server (shared/text.ts).
 */
export function Note(props: WidgetProps) {
  const s = () => props.session;
  const [editing, setEditing] = createSignal(false);
  let textarea: HTMLTextAreaElement | undefined;
  let mirror: HTMLDivElement | undefined;
  /** What the textarea shows. Each input is diffed against it to make an edit. */
  let shown = "";
  /**
   * Others' edits that arrived while an input method was composing (IME),
   * held back so the composition isn't broken, and shown when it ends.
   */
  let unseen: TextOp | null = null;
  let composing = false;
  let unwatch: (() => void) | null = null;
  onCleanup(() => unwatch?.());

  const typists = createMemo(() => s().typists(props.id));
  const carets = createMemo((): Caret[] =>
    typists().flatMap((p) => {
      const c = p.presence.caret;
      return c ? [{ sid: p.sid, start: c.start, end: c.end, hue: p.hue, name: p.name }] : [];
    }),
  );

  /**
   * Text you typed that the bento refused (the note filled up, you became a
   * viewer, or you were away too long to catch up), kept so nothing you
   * wrote vanishes. Shown until you dismiss it, or until the note's text
   * matches it.
   */
  const showUnsaved = () => {
    const u = s().lostText(props.id);
    return u !== null && u !== s().text(props.id) ? u : null;
  };

  // Typing refused ends the edit, with the words kept on the note.
  createEffect(
    () => editing() && s().lostText(props.id) !== null,
    (hit) => {
      if (!hit) return;
      stopEditing();
      props.onNotice?.("Your last words didn't save; they're kept on the note.");
    },
  );

  // Made a viewer mid-sentence: the editor closes.
  createEffect(
    () => editing() && Boolean(props.readOnly),
    (stop) => {
      if (stop) stopEditing();
    },
  );

  async function copyUnsaved() {
    const text = s().lostText(props.id);
    if (text === null) return;
    try {
      await navigator.clipboard.writeText(text);
      s().dismissLost(props.id);
      props.onNotice?.("Copied your text.");
    } catch {
      props.onError("Couldn't copy. Select the text and copy it instead.");
    }
  }

  // Fill and focus the textarea once it exists.
  createEffect(
    () => editing(),
    (on) => {
      if (on && textarea) {
        textarea.value = shown;
        textarea.focus();
        const end = textarea.value.length;
        textarea.setSelectionRange(end, end);
        sendCaret();
      }
    },
  );

  /**
   * Someone else's edit, as an edit of the text you see. Applied to the
   * textarea with your caret and selection moved along with the text, so
   * you can keep typing through it. Null: the text was replaced.
   */
  function showRemote(op: TextOp | null, text: string) {
    if (op === null) {
      unseen = null;
      shown = text;
      if (textarea) textarea.value = shown;
      return;
    }
    if (!textarea) {
      shown = applyText(shown, op);
      return;
    }
    if (composing) {
      unseen = unseen ? composeText(unseen, op) : op;
      return;
    }
    const { selectionStart, selectionEnd, selectionDirection, scrollTop } = textarea;
    shown = applyText(shown, op);
    textarea.value = shown;
    textarea.setSelectionRange(
      transformIndex(selectionStart, op),
      transformIndex(selectionEnd, op),
      selectionDirection,
    );
    textarea.scrollTop = scrollTop;
  }

  function startEditing() {
    if (editing() || props.readOnly) return;
    shown = s().text(props.id);
    unseen = null;
    unwatch = s().watchText(props.id, showRemote);
    setEditing(true);
    s().setPresence({ action: "typing" });
  }

  function stopEditing() {
    if (!editing()) return;
    setEditing(false);
    unwatch?.();
    unwatch = null;
    composing = false;
    s().setPresence({ action: null, caret: null });
  }

  function sendCaret() {
    if (!textarea) return;
    s().setPresence({
      caret: { id: props.id, start: textarea.selectionStart, end: textarea.selectionEnd },
    });
  }

  /** Others' carets drawn behind the textarea scroll with it. */
  function syncMirror() {
    if (mirror && textarea) mirror.scrollTop = textarea.scrollTop;
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
    const after = el.value;
    const op = diffText(shown, after, el.selectionEnd);
    shown = after;
    if (unseen) {
      // The session already has the held-back edits; ours goes after them.
      const held = unseen;
      unseen = transformText(held, op, "left");
      s().editText(props.id, transformText(op, held, "right"));
    } else s().editText(props.id, op);
    sendCaret();
    syncMirror();
  }

  function onCompositionEnd() {
    composing = false;
    const held = unseen;
    unseen = null;
    if (held) showRemote(held, applyText(shown, held));
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
      onActivate={startEditing}
      onKey={onKey}
    >
      <div class={styles.body}>
        <Show
          when={editing()}
          fallback={
            <NoteText
              text={s().text(props.id)}
              carets={carets()}
              placeholder={typists().length ? "" : "Click to write…"}
            />
          }
        >
          <Show when={carets().length > 0}>
            <div ref={mirror} class={[styles.text, styles.mirror]} aria-hidden="true">
              <CaretText text={s().text(props.id)} carets={carets()} />
            </div>
          </Show>
          <textarea
            ref={textarea}
            class={styles.input}
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
            onScroll={syncMirror}
            onCompositionStart={() => (composing = true)}
            onCompositionEnd={onCompositionEnd}
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
                <button type="button" onClick={() => s().dismissLost(props.id)}>
                  Dismiss
                </button>
              </div>
            </div>
          )}
        </Show>
      </div>

      <footer class={frameParts.meta}>
        <Show
          when={typists().length > 0 && typists()}
          fallback={<span class={frameParts.byline}>by {author()}</span>}
        >
          {(people) => (
            <span class={frameParts.typing} style={personVars(people()[0]!.hue)}>
              {names(people())} {people().length === 1 ? "is" : "are"} typing
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
 * Text split up around other people's carets and selections: each
 * selection highlighted in its owner's color, each caret a beam with a name
 * flag. Plain text, so carets line up character for character.
 */
type Piece = { text: string; hue: number | null } | { caret: Caret };
const caretOf = (p: Piece) => ("caret" in p ? p.caret : null);
const markOf = (p: Piece) => (!("caret" in p) && p.hue !== null ? { text: p.text, hue: p.hue } : null);
const textOf = (p: Piece) => ("caret" in p ? "" : p.text);

function CaretText(props: { text: string; carets: Caret[] }) {
  const pieces = createMemo((): Piece[] => {
    const t = props.text;
    const clamp = (n: number) => Math.max(0, Math.min(n, t.length));
    const cs = props.carets.map((c) => ({
      c,
      a: clamp(Math.min(c.start, c.end)),
      b: clamp(Math.max(c.start, c.end)),
      at: clamp(c.end),
    }));
    const cuts = [...new Set([0, t.length, ...cs.flatMap((x) => [x.a, x.b, x.at])])].sort((x, y) => x - y);
    const out: Piece[] = [];
    cuts.forEach((at, i) => {
      for (const x of cs) if (x.at === at) out.push({ caret: x.c });
      const to = cuts[i + 1];
      if (to === undefined) return;
      const cover = cs.find((x) => x.a < x.b && x.a <= at && to <= x.b);
      out.push({ text: t.slice(at, to), hue: cover ? cover.c.hue : null });
    });
    return out;
  });
  return (
    // Pieces are rebuilt on every keystroke; keyed by position, the DOM is reused.
    <For each={pieces()} keyed={false}>
      {(piece) => (
        <Switch fallback={textOf(piece())}>
          <Match when={caretOf(piece())}>
            {(c) => (
              <span class={styles.caret} style={personVars(c().hue)} aria-hidden="true">
                <span class={styles.flag}>{c().name}</span>
              </span>
            )}
          </Match>
          <Match when={markOf(piece())}>
            {(m) => (
              <mark class={styles.selection} style={personVars(m().hue)}>
                {m().text}
              </mark>
            )}
          </Match>
        </Switch>
      )}
    </For>
  );
}

/**
 * Read-only text, with other people's carets and selections drawn in their
 * colors. Uses the same typography as the textarea, so text doesn't shift
 * when you start typing.
 */
function NoteText(props: { text: string; placeholder: string; carets: Caret[] }) {
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
        when={props.carets.length > 0}
        fallback={
          props.text ? (
            <NoteLines text={props.text} />
          ) : (
            <span class={styles.placeholder}>{props.placeholder}</span>
          )
        }
      >
        <CaretText text={props.text} carets={props.carets} />
      </Show>
    </div>
  );
}

/**
 * The note's text with its markdown shown: headings, lists, boxes, quotes
 * and inline styles. While someone else types it falls back to plain text,
 * so their carets line up character for character.
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
