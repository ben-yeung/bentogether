import { createSignal, createUniqueId, For, onSettled, Show } from "solid-js";
import styles from "./Select.module.css";

export type SelectOption<T extends string> = { value: T; label: string };

/**
 * A dropdown in our own colors. The native <select> opens an OS-drawn list
 * we can't style, so this is a button plus a listbox. The list opens in the
 * top layer (popover), so dialogs and widgets with overflow never clip it.
 *
 * Keys: Enter, Space or ↓/↑ opens; ↑/↓, Home/End move; Enter/Space picks;
 * Esc or Tab closes. Typing a letter jumps to the next option that starts
 * with it.
 *
 * `class` styles the trigger (e.g. "field-select" for the quiet underline
 * look); `align` sets which edge of the trigger the list lines up with.
 */
export function Select<T extends string>(props: {
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  label: string;
  class?: string | (string | undefined)[] | undefined;
  listClass?: string | undefined;
  title?: string | undefined;
  disabled?: boolean | undefined;
  align?: "start" | "end";
}) {
  const id = createUniqueId();
  const [open, setOpen] = createSignal(false);
  const [active, setActive] = createSignal(0);
  let trigger!: HTMLButtonElement;
  let list!: HTMLUListElement;

  const index = () =>
    Math.max(
      0,
      props.options.findIndex((o) => o.value === props.value),
    );
  const current = () => props.options[index()];

  function place() {
    const r = trigger.getBoundingClientRect();
    const gap = 4;
    const margin = 8;
    list.style.minWidth = `${r.width}px`;
    const w = list.offsetWidth;
    const h = list.offsetHeight;
    let left = props.align === "end" ? r.right - w : r.left;
    left = Math.min(Math.max(margin, left), innerWidth - w - margin);
    const below = innerHeight - r.bottom - gap - margin;
    const top = h <= below || r.top < below ? r.bottom + gap : r.top - gap - h;
    list.style.left = `${left}px`;
    list.style.top = `${Math.max(margin, top)}px`;
  }

  function show(at = index()) {
    if (props.disabled || open()) return;
    setActive(at);
    setOpen(true);
    list.showPopover();
    place();
    list.focus({ preventScroll: true });
    list.children[at]?.scrollIntoView({ block: "nearest" });
  }

  function hide(refocus = true) {
    if (!open()) return;
    setOpen(false);
    list.hidePopover();
    if (refocus) trigger.focus({ preventScroll: true });
  }

  function pick(i: number) {
    const o = props.options[i];
    hide();
    if (o && o.value !== props.value) props.onChange(o.value);
  }

  function move(i: number) {
    const n = props.options.length;
    const next = (i + n) % n;
    setActive(next);
    list.children[next]?.scrollIntoView({ block: "nearest" });
  }

  function jump(ch: string) {
    const n = props.options.length;
    for (let k = 1; k <= n; k++) {
      const i = (active() + k) % n;
      if (props.options[i]!.label.toLowerCase().startsWith(ch)) return move(i);
    }
  }

  function onTriggerKey(e: KeyboardEvent) {
    if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(e.key)) {
      e.preventDefault();
      show();
    }
  }

  function onListKey(e: KeyboardEvent) {
    const keys: Record<string, () => void> = {
      ArrowDown: () => move(active() + 1),
      ArrowUp: () => move(active() - 1),
      Home: () => move(0),
      End: () => move(props.options.length - 1),
      Enter: () => pick(active()),
      " ": () => pick(active()),
      Escape: () => hide(),
      Tab: () => hide(),
    };
    const run = keys[e.key];
    if (run) {
      // Tab still moves focus on from the trigger.
      if (e.key !== "Tab") e.preventDefault();
      e.stopPropagation();
      run();
    } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
      jump(e.key.toLowerCase());
    }
  }

  onSettled(() => {
    const outside = (e: Event) => {
      const t = e.target as Node;
      if (open() && !list.contains(t) && !trigger.contains(t)) hide(false);
    };
    // The list is placed once; if the page moves under it, close it.
    const away = (e: Event) => {
      if (open() && !(e.target instanceof Node && list.contains(e.target))) hide(false);
    };
    addEventListener("pointerdown", outside, true);
    addEventListener("scroll", away, true);
    addEventListener("resize", away);
    return () => {
      removeEventListener("pointerdown", outside, true);
      removeEventListener("scroll", away, true);
      removeEventListener("resize", away);
    };
  });

  return (
    <span class={styles.wrap} data-nodrag>
      <button
        ref={trigger}
        type="button"
        class={props.class}
        aria-label={props.label}
        title={props.title}
        aria-haspopup="listbox"
        aria-expanded={open() ? "true" : "false"}
        aria-controls={`${id}-list`}
        disabled={props.disabled}
        onClick={() => (open() ? hide() : show())}
        onKeyDown={onTriggerKey}
      >
        {current()?.label}
      </button>
      <ul
        ref={list}
        id={`${id}-list`}
        popover="manual"
        role="listbox"
        tabindex="-1"
        class={[styles.list, props.listClass]}
        aria-label={props.label}
        aria-activedescendant={open() ? `${id}-${active()}` : undefined}
        onKeyDown={onListKey}
        onFocusOut={(e) => {
          const to = e.relatedTarget as Node | null;
          if (to && !list.contains(to) && to !== trigger) hide(false);
        }}
      >
        <For each={props.options}>
          {(o, i) => (
            <li
              id={`${id}-${i()}`}
              role="option"
              class={styles.option}
              aria-selected={o.value === props.value ? "true" : "false"}
              data-active={open() && active() === i() ? "" : undefined}
              onPointerMove={() => setActive(i())}
              onClick={() => pick(i())}
            >
              <span>{o.label}</span>
              <Show when={o.value === props.value}>
                <svg class={styles.check} viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M2.5 6.3 5 8.6l4.5-5" />
                </svg>
              </Show>
            </li>
          )}
        </For>
      </ul>
    </span>
  );
}
