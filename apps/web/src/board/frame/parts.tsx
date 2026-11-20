import { createMemo, createSignal, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import {
  SYSTEM_AUTHOR,
  WIDGET_TITLE_MAX,
  type ChangeBody,
  type ChangeOf,
  type FramedKind,
} from "@bentogether/shared";
import type { BoxSession } from "../session";
import { ColorTools } from "./ColorTools";
import { frameParts } from "./WidgetFrame";
import styles from "./parts.module.css";

export { styles as parts };

/** Widgets this many columns wide or narrower fold the swatches into one dot. */
const COMPACT_TOOLS_MAX_W = 3;

/** A person's name, or "bento" for things the box made itself (the starter bento). */
export function shownName(name: string): string {
  return name === SYSTEM_AUTHOR ? "bento" : name;
}

/** "by Mochi", or "by bento" for ones the box made itself. */
export function useAuthor(props: { id: string; session: BoxSession }) {
  return createMemo(() => {
    const by = props.session.widget(props.id)?.createdBy ?? "";
    return by === SYSTEM_AUTHOR ? "bento" : by;
  });
}

/**
 * Rows keyed by id, as To-do does: `ids` only changes when the order or
 * membership does, and each row looks its record up by id, so a row (and
 * any edit open in it) survives everyone else's changes.
 */
export function createRows<T extends { id: string }>(list: () => readonly T[]) {
  const ids = createMemo(() => list().map((x) => x.id), {
    equals: (a, b) => a.length === b.length && a.every((v, i) => v === b[i]),
  });
  const byId = createMemo(() => new Map(list().map((x) => [x.id, x])));
  return { ids, get: (id: string) => byId().get(id) };
}

/** Sends changes of one kind to one widget; failures show as a toast. */
export function changer<K extends FramedKind>(
  props: { id: string; session: BoxSession; onError: (message: string) => void },
  kind: K,
) {
  return (c: ChangeBody<K>) =>
    props.session
      .change(props.id, { kind, ...c } as unknown as ChangeOf<K>)
      .catch((e: Error) => props.onError(e.message));
}

/** Focus a field once it's in the page, with its text selected. */
export function focusOnMount(el: HTMLInputElement) {
  setTimeout(() => {
    el.focus();
    el.select();
  }, 0);
}

/** The widget's title line; last one saved wins. */
export function TitleLine(props: {
  id: string;
  session: BoxSession;
  readOnly: boolean;
  placeholder: string;
  label: string;
  onError: (message: string) => void;
}) {
  const s = () => props.session;
  const title = () => s().listTitle(props.id);
  const [draft, setDraft] = createSignal<string | null>(null);

  function commit() {
    const next = draft();
    setDraft(null);
    s().setPresence({ action: null });
    if (next === null || next.trim() === title()) return;
    s()
      .setListTitle(props.id, next.trim())
      .catch((e: Error) => props.onError(e.message));
  }

  return (
    <input
      class={[styles.plain, styles.title]}
      value={draft() ?? title()}
      size={Math.max(2, ((draft() ?? title()) || props.placeholder).length)}
      placeholder={props.placeholder}
      maxlength={WIDGET_TITLE_MAX}
      aria-label={props.label}
      readonly={props.readOnly}
      onFocus={() => {
        if (props.readOnly) return;
        setDraft(title());
        s().setPresence({ action: "typing" });
      }}
      onInput={(e) => void setDraft(e.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(null);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/** "+ Add an idea": Enter adds and keeps the field, so you can add several. */
export function AddField(props: {
  session: BoxSession;
  placeholder: string;
  max: number;
  onAdd: (text: string) => void;
  ref?: (el: HTMLInputElement) => void;
  class?: string;
}) {
  let input!: HTMLInputElement;
  return (
    <form
      class={[styles.add, props.class]}
      onSubmit={(e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        input.value = "";
        props.onAdd(text);
      }}
    >
      <span class={styles.plus} aria-hidden="true">
        +
      </span>
      <input
        ref={(el) => {
          input = el;
          props.ref?.(el);
        }}
        class={styles.plain}
        placeholder={props.placeholder}
        maxlength={props.max}
        aria-label={props.placeholder}
        onFocus={() => props.session.setPresence({ action: "typing" })}
        onBlur={() => props.session.setPresence({ action: null })}
        onKeyDown={(e) => {
          if (e.key === "Escape") e.currentTarget.blur();
        }}
      />
    </form>
  );
}

/**
 * Text you click to edit in place. Enter or clicking away saves; Escape
 * cancels; emptying it calls onEmpty (usually remove).
 */
export function EditableText(props: {
  text: string;
  readOnly: boolean;
  max: number;
  label: string;
  class?: string;
  onSave: (text: string) => void;
  onEmpty?: () => void;
  onEditing?: (on: boolean) => void;
}) {
  const [draft, setDraft] = createSignal<string | null>(null);

  function commit() {
    const next = draft();
    if (next === null) return;
    setDraft(null);
    props.onEditing?.(false);
    const text = next.trim();
    if (!text) props.onEmpty?.();
    else if (text !== props.text) props.onSave(text);
  }

  return (
    <Show
      when={draft() !== null}
      fallback={
        <span
          class={props.class}
          data-nodrag={props.readOnly ? undefined : ""}
          style={{ cursor: props.readOnly ? undefined : "text" }}
          onClick={() => {
            if (props.readOnly) return;
            setDraft(props.text);
            props.onEditing?.(true);
          }}
        >
          {props.text}
        </span>
      }
    >
      <input
        ref={focusOnMount}
        class={[styles.plain, styles.editing, props.class]}
        value={draft()!}
        maxlength={props.max}
        aria-label={props.label}
        onInput={(e) => void setDraft(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(null);
            props.onEditing?.(false);
          }
        }}
      />
    </Show>
  );
}

/** A garbage can: lid with a handle, a tapered bin, two slats. */
export function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.75 4.25h10.5M6.25 4.25V2.75h3.5v1.5M4.25 4.25l.7 8.6a1 1 0 0 0 1 .9h4.1a1 1 0 0 0 1-.9l.7-8.6M6.85 6.75v4.5M9.15 6.75v4.5" />
    </svg>
  );
}

/** A remove button that shows on hover of its row. */
export function RemoveButton(props: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      class={[styles.icon, styles.onHover]}
      aria-label={props.label}
      onClick={() => props.onClick()}
    >
      <TrashIcon />
    </button>
  );
}

/** The bottom row: byline, anything extra, then hover tools ending in the colors. */
export function Footer(props: {
  id: string;
  session: BoxSession;
  readOnly: boolean;
  width: number;
  author: string;
  colorLabel: string;
  onError: (message: string) => void;
  /** Beside the byline: a count, a status. */
  info?: JSX.Element;
  /** Editor tools before the colors. */
  tools?: JSX.Element;
  /** Tools everyone gets, viewers too. */
  viewerTools?: JSX.Element;
  /** Keep the tools showing (say, while a mode they control is on). */
  pinned?: boolean;
}) {
  const s = () => props.session;
  return (
    <footer class={frameParts.meta}>
      <span class={frameParts.byline}>by {props.author}</span>
      {props.info}
      <div class={[frameParts.tools, { [frameParts.toolsPinned!]: !!props.pinned }]} data-intent="tools">
        {props.viewerTools}
        <Show when={!props.readOnly}>
          {props.tools}
          <ColorTools
            color={s().color(props.id)}
            compact={props.width <= COMPACT_TOOLS_MAX_W}
            label={props.colorLabel}
            onPick={(c) =>
              s()
                .recolor(props.id, c)
                .catch((e: Error) => props.onError(e.message))
            }
          />
        </Show>
      </div>
    </footer>
  );
}
