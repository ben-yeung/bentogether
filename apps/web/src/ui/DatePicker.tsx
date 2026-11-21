import { createMemo, createSignal, createUniqueId, For, onSettled } from "solid-js";
import { addDays, addMonths, fromDateStr, monthGrid, sameMonth, startOfWeek, toDateStr } from "../lib/dates";
import styles from "./DatePicker.module.css";

/**
 * A date field in our own colors, the calendar sibling of <Select>. The
 * native date input opens an OS-drawn calendar we can't style, so this is a
 * button plus a month grid in the top layer (popover).
 *
 * Keys: Enter, Space or ↓ opens; arrows move a day or a week; PageUp/PageDown
 * a month; Home/End the start/end of the week; Enter/Space picks; Esc or Tab
 * closes.
 */
export function DatePicker(props: {
  /** A plain date, "2026-11-20". */
  value: string;
  onChange: (value: string) => void;
  label: string;
  class?: string | (string | undefined)[] | undefined;
  align?: "start" | "end";
}) {
  const id = createUniqueId();
  const [open, setOpen] = createSignal(false);
  /** The day the keyboard is on; its month is the one showing. */
  const [active, setActive] = createSignal(toDateStr(new Date()));
  let trigger!: HTMLButtonElement;
  let pop!: HTMLDivElement;
  let grid!: HTMLDivElement;

  const today = () => toDateStr(new Date());
  const shown = () =>
    fromDateStr(props.value).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  const heading = createMemo(() =>
    fromDateStr(active()).toLocaleDateString(undefined, { month: "long", year: "numeric" }),
  );
  const weekdays = createMemo(() =>
    Array.from({ length: 7 }, (_, i) =>
      fromDateStr(addDays(startOfWeek(active()), i)).toLocaleDateString(undefined, { weekday: "narrow" }),
    ),
  );
  const days = createMemo(() => monthGrid(active()));

  function place() {
    const r = trigger.getBoundingClientRect();
    const gap = 4;
    const margin = 8;
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    let left = props.align === "end" ? r.right - w : r.left;
    left = Math.min(Math.max(margin, left), innerWidth - w - margin);
    const below = innerHeight - r.bottom - gap - margin;
    const top = h <= below || r.top < below ? r.bottom + gap : r.top - gap - h;
    pop.style.left = `${left}px`;
    pop.style.top = `${Math.max(margin, top)}px`;
  }

  function show() {
    if (open()) return;
    setActive(props.value);
    setOpen(true);
    pop.showPopover();
    place();
    grid.focus({ preventScroll: true });
  }

  function hide(refocus = true) {
    if (!open()) return;
    setOpen(false);
    pop.hidePopover();
    if (refocus) trigger.focus({ preventScroll: true });
  }

  function pick(date: string) {
    hide();
    if (date !== props.value) props.onChange(date);
  }

  function onGridKey(e: KeyboardEvent) {
    const a = active();
    const keys: Record<string, () => void> = {
      ArrowLeft: () => setActive(addDays(a, -1)),
      ArrowRight: () => setActive(addDays(a, 1)),
      ArrowUp: () => setActive(addDays(a, -7)),
      ArrowDown: () => setActive(addDays(a, 7)),
      PageUp: () => setActive(addMonths(a, -1)),
      PageDown: () => setActive(addMonths(a, 1)),
      Home: () => setActive(startOfWeek(a)),
      End: () => setActive(addDays(startOfWeek(a), 6)),
      Enter: () => pick(a),
      " ": () => pick(a),
    };
    const run = keys[e.key];
    if (!run) return;
    e.preventDefault();
    e.stopPropagation();
    run();
  }

  onSettled(() => {
    const outside = (e: Event) => {
      const t = e.target as Node;
      if (open() && !pop.contains(t) && !trigger.contains(t)) hide(false);
    };
    // The card is placed once; if the page moves under it, close it.
    const away = (e: Event) => {
      if (open() && !(e.target instanceof Node && pop.contains(e.target))) hide(false);
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
        aria-label={`${props.label}: ${shown()}`}
        aria-haspopup="dialog"
        aria-expanded={open() ? "true" : "false"}
        aria-controls={`${id}-pop`}
        onClick={() => (open() ? hide() : show())}
        onKeyDown={(e) => {
          if (["Enter", " ", "ArrowDown"].includes(e.key)) {
            e.preventDefault();
            show();
          }
        }}
      >
        {shown()}
      </button>
      <div
        ref={pop}
        id={`${id}-pop`}
        popover="manual"
        role="dialog"
        aria-label={props.label}
        class={styles.pop}
        onKeyDown={(e) => {
          if (e.key === "Escape" || e.key === "Tab") {
            if (e.key === "Escape") e.preventDefault();
            e.stopPropagation();
            hide();
          }
        }}
        onFocusOut={(e) => {
          const to = e.relatedTarget as Node | null;
          if (to && !pop.contains(to) && to !== trigger) hide(false);
        }}
      >
        <div class={styles.head}>
          <button
            type="button"
            class={styles.nav}
            tabindex="-1"
            aria-label="Previous month"
            onClick={() => setActive(addMonths(active(), -1))}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M10 3.5 5.5 8l4.5 4.5" />
            </svg>
          </button>
          <span class={styles.month} aria-live="polite">
            {heading()}
          </span>
          <button
            type="button"
            class={styles.nav}
            tabindex="-1"
            aria-label="Next month"
            onClick={() => setActive(addMonths(active(), 1))}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M6 3.5 10.5 8 6 12.5" />
            </svg>
          </button>
        </div>
        <div
          ref={grid}
          class={styles.grid}
          role="grid"
          tabindex="0"
          aria-label={heading()}
          aria-activedescendant={open() ? `${id}-${active()}` : undefined}
          onKeyDown={onGridKey}
        >
          <For each={weekdays()}>
            {(w) => (
              <span class={styles.weekday} aria-hidden="true">
                {w}
              </span>
            )}
          </For>
          <For each={days()}>
            {(date) => (
              <span
                id={`${id}-${date}`}
                role="gridcell"
                class={styles.day}
                aria-selected={date === props.value ? "true" : "false"}
                aria-label={fromDateStr(date).toLocaleDateString(undefined, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
                data-other={!sameMonth(date, active()) ? "" : undefined}
                data-today={date === today() ? "" : undefined}
                data-active={date === active() ? "" : undefined}
                onPointerMove={() => sameMonth(date, active()) && setActive(date)}
                onClick={() => pick(date)}
              >
                {fromDateStr(date).getDate()}
              </span>
            )}
          </For>
        </div>
        <div class={styles.foot}>
          <button type="button" class={styles.today} tabindex="-1" onClick={() => pick(today())}>
            Today
          </button>
        </div>
      </div>
    </span>
  );
}
