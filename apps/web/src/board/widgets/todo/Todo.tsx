import { createMemo, createSignal, For, Show } from "solid-js";
import {
  SYSTEM_AUTHOR,
  TODO_ITEMS_MAX,
  TODO_TEXT_MAX,
  WIDGET_TITLE_MAX,
  randomId,
  type TodoChange,
  type TodoItem,
} from "@bentogether/shared";
import { ColorTools } from "../../frame/ColorTools";
import { WidgetFrame, frameParts, type WidgetProps } from "../../frame/WidgetFrame";
import styles from "./Todo.module.css";

/** Lists this many columns wide or narrower fold the swatches into one dot. */
const COMPACT_TOOLS_MAX_W = 3;

/**
 * A shared checklist: a title line, then items anyone can add, tick, edit,
 * reorder and remove. Each change touches one item, so people can work on
 * the same list at once without undoing each other.
 */
export function Todo(props: WidgetProps) {
  const s = () => props.session;
  const fail = (err: Error) => props.onError(err.message);
  const change = (c: TodoChange) => s().changeItem(props.id, c).catch(fail);

  const items = createMemo(() => s().items(props.id));
  /** Rows are keyed by item id, so a row (and any edit in it) survives others' changes. */
  const ids = createMemo(() => items().map((i) => i.id), {
    equals: (a, b) => a.length === b.length && a.every((v, i) => v === b[i]),
  });
  const byId = createMemo(() => new Map(items().map((i) => [i.id, i])));
  const doneCount = createMemo(() => items().filter((i) => i.done).length);

  const author = createMemo(() => {
    const by = s().widget(props.id)?.createdBy ?? "";
    return by === SYSTEM_AUTHOR ? "bento" : by;
  });
  const title = () => s().listTitle(props.id);

  // ------------------------------------------------------------- title

  const [titleDraft, setTitleDraft] = createSignal<string | null>(null);

  function commitTitle() {
    const next = titleDraft();
    setTitleDraft(null);
    s().setPresence({ action: null });
    if (next === null || next.trim() === title()) return;
    s().setListTitle(props.id, next.trim()).catch(fail);
  }

  // --------------------------------------------------------------- add

  let addInput: HTMLInputElement | undefined;

  function addItem(e: SubmitEvent) {
    e.preventDefault();
    const text = addInput?.value.trim() ?? "";
    if (!text) return;
    if (items().length >= TODO_ITEMS_MAX) {
      props.onError("This list is full.");
      return;
    }
    addInput!.value = "";
    void change({ do: "add", itemId: randomId(12), text });
  }

  // ---------------------------------------------------------- reorder

  let listEl: HTMLUListElement | undefined;
  const [drop, setDrop] = createSignal<{ from: string; at: number } | null>(null);

  /** Drag a row by its grip; a line shows where it will land. */
  function beginReorder(e: PointerEvent, itemId: string) {
    if (e.button !== 0 || !listEl) return;
    e.preventDefault();
    e.stopPropagation();
    const from = ids().indexOf(itemId);
    const rows = () => [...listEl!.querySelectorAll<HTMLElement>("[data-item]")];
    const indexAt = (y: number) => {
      const all = rows();
      const i = all.findIndex((r) => {
        const b = r.getBoundingClientRect();
        return y < b.top + b.height / 2;
      });
      return i === -1 ? all.length : i;
    };
    setDrop({ from: itemId, at: from });
    s().setPresence({ action: "moving" });
    const move = (ev: PointerEvent) => setDrop({ from: itemId, at: indexAt(ev.clientY) });
    const end = (ev: PointerEvent) => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", end);
      removeEventListener("pointercancel", end);
      const at = drop()?.at ?? from;
      setDrop(null);
      s().setPresence({ action: null });
      if (ev.type === "pointercancel") return;
      // Dropping below itself means one slot higher once it's lifted out.
      const to = at > from ? at - 1 : at;
      if (to !== from) void change({ do: "move", itemId, to });
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", end);
    addEventListener("pointercancel", end);
  }

  /** Alt+Up / Alt+Down move the focused row. */
  function keyMove(e: KeyboardEvent, itemId: string) {
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return false;
    e.preventDefault();
    const from = ids().indexOf(itemId);
    const to = from + (e.key === "ArrowUp" ? -1 : 1);
    if (to >= 0 && to < ids().length) void change({ do: "move", itemId, to });
    return true;
  }

  return (
    <WidgetFrame
      {...props}
      kind="todo"
      class={styles.todo}
      color={s().color(props.id)}
      label={`To-do by ${author()}: ${title() || "untitled"}, ${doneCount()} of ${items().length} done`}
      deleteLabel="Delete list"
      onActivate={props.readOnly ? undefined : () => addInput?.focus()}
    >
      <input
        class={styles.title}
        value={titleDraft() ?? title()}
        size={Math.max(
          2,
          ((titleDraft() ?? title()) || (props.readOnly ? "To-do" : "Name this list")).length,
        )}
        placeholder={props.readOnly ? "To-do" : "Name this list"}
        maxlength={WIDGET_TITLE_MAX}
        aria-label="List title"
        readonly={props.readOnly}
        onFocus={() => {
          if (props.readOnly) return;
          setTitleDraft(title());
          s().setPresence({ action: "typing" });
        }}
        onInput={(e) => void setTitleDraft(e.currentTarget.value)}
        onBlur={commitTitle}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setTitleDraft(null);
            e.currentTarget.blur();
          }
        }}
      />

      <ul class={styles.list} ref={listEl} aria-label="Items">
        <For each={ids()}>
          {(itemId, index) => (
            <Show when={byId().get(itemId)}>
              {(item) => (
                <Row
                  item={item()}
                  readOnly={props.readOnly}
                  dropBefore={drop() !== null && drop()!.at === index() && drop()!.from !== itemId}
                  dragging={drop()?.from === itemId}
                  onChange={change}
                  onGrip={(e) => beginReorder(e, itemId)}
                  onKeyMove={(e) => keyMove(e, itemId)}
                  onEditing={(on) => s().setPresence({ action: on ? "typing" : null })}
                />
              )}
            </Show>
          )}
        </For>
        <Show when={drop() !== null && drop()!.at === ids().length}>
          <li class={styles.dropEnd} aria-hidden="true" />
        </Show>
        <Show when={props.readOnly && ids().length === 0}>
          <li class={styles.empty}>Nothing on this list yet.</li>
        </Show>
      </ul>

      <Show when={!props.readOnly}>
        <form class={styles.add} onSubmit={addItem}>
          <span class={styles.plus} aria-hidden="true">
            +
          </span>
          <input
            ref={addInput}
            class={styles.addInput}
            placeholder="Add an item"
            maxlength={TODO_TEXT_MAX}
            aria-label="Add an item"
            onFocus={() => s().setPresence({ action: "typing" })}
            onBlur={() => s().setPresence({ action: null })}
            onKeyDown={(e) => {
              if (e.key === "Escape") e.currentTarget.blur();
            }}
          />
        </form>
      </Show>

      <footer class={frameParts.meta}>
        <span class={frameParts.byline}>by {author()}</span>
        <Show when={!props.readOnly}>
          <div class={frameParts.tools} data-intent="tools">
            <Show when={doneCount() > 0}>
              <button type="button" class={styles.clear} onClick={() => void change({ do: "clearDone" })}>
                Clear done
              </button>
            </Show>
            <ColorTools
              color={s().color(props.id)}
              compact={props.rect.w <= COMPACT_TOOLS_MAX_W}
              label="List color"
              onPick={(c) => s().recolor(props.id, c).catch(fail)}
            />
          </div>
        </Show>
        <Show when={items().length > 0}>
          <span class={[frameParts.stat, styles.count]}>
            {doneCount()}/{items().length}
          </span>
        </Show>
      </footer>
    </WidgetFrame>
  );
}

/** One item: a checkbox, its text (click to edit), a grip and remove on hover. */
function Row(props: {
  item: TodoItem;
  readOnly: boolean;
  dropBefore: boolean;
  dragging: boolean;
  onChange: (c: TodoChange) => unknown;
  onGrip: (e: PointerEvent) => void;
  onKeyMove: (e: KeyboardEvent) => boolean;
  onEditing: (on: boolean) => void;
}) {
  const [draft, setDraft] = createSignal<string | null>(null);

  function startEdit() {
    if (props.readOnly || draft() !== null) return;
    setDraft(props.item.text);
    props.onEditing(true);
  }

  /** Focus the field once it's in the page. */
  function focusOnMount(el: HTMLInputElement) {
    setTimeout(() => {
      el.focus();
      el.select();
    }, 0);
  }

  function commit() {
    const next = draft();
    if (next === null) return;
    setDraft(null);
    props.onEditing(false);
    const text = next.trim();
    // Emptying an item's text removes it.
    if (!text) props.onChange({ do: "remove", itemId: props.item.id });
    else if (text !== props.item.text) props.onChange({ do: "edit", itemId: props.item.id, text });
  }

  return (
    <li
      class={styles.row}
      data-item={props.item.id}
      data-done={props.item.done}
      data-drop-before={props.dropBefore}
      data-dragging={props.dragging}
    >
      <Show when={!props.readOnly}>
        <span class={styles.grip} data-nodrag aria-hidden="true" onPointerDown={(e) => props.onGrip(e)}>
          <svg viewBox="0 0 6 10">
            <circle cx="1.5" cy="2" r="0.9" />
            <circle cx="4.5" cy="2" r="0.9" />
            <circle cx="1.5" cy="5" r="0.9" />
            <circle cx="4.5" cy="5" r="0.9" />
            <circle cx="1.5" cy="8" r="0.9" />
            <circle cx="4.5" cy="8" r="0.9" />
          </svg>
        </span>
      </Show>
      <button
        type="button"
        role="checkbox"
        class={styles.check}
        aria-checked={props.item.done ? "true" : "false"}
        aria-label={props.item.text}
        aria-disabled={props.readOnly ? "true" : undefined}
        onClick={() => {
          if (!props.readOnly) props.onChange({ do: "check", itemId: props.item.id, done: !props.item.done });
        }}
        onKeyDown={(e) => {
          if (!props.readOnly && props.onKeyMove(e)) e.stopPropagation();
        }}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 6.2 5 8.6l4.5-5" />
        </svg>
      </button>
      <Show
        when={draft() !== null}
        fallback={
          <span class={styles.text} data-nodrag={props.readOnly ? undefined : ""} onClick={startEdit}>
            {props.item.text}
          </span>
        }
      >
        <input
          ref={focusOnMount}
          class={styles.edit}
          value={draft()!}
          maxlength={TODO_TEXT_MAX}
          aria-label="Item text"
          onInput={(e) => void setDraft(e.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setDraft(null);
              props.onEditing(false);
            }
          }}
        />
      </Show>
      <Show when={!props.readOnly}>
        <button
          type="button"
          class={styles.removeItem}
          aria-label={`Remove ${props.item.text}`}
          onClick={() => props.onChange({ do: "remove", itemId: props.item.id })}
        >
          {/* A garbage can: lid with a handle, a tapered bin, two slats. */}
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M2.75 4.25h10.5M6.25 4.25V2.75h3.5v1.5M4.25 4.25l.7 8.6a1 1 0 0 0 1 .9h4.1a1 1 0 0 0 1-.9l.7-8.6M6.85 6.75v4.5M9.15 6.75v4.5" />
          </svg>
        </button>
      </Show>
    </li>
  );
}
