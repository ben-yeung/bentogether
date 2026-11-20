import { createMemo, createSignal, For, Show } from "solid-js";
import { bitsToSlots, FREE_DAYS, FREE_SLOTS, slotAt, slotsToBits } from "@bentogether/shared";
import { personColor, personVars } from "../../../lib/identity";
import { WidgetFrame, type WidgetProps } from "../../frame/WidgetFrame";
import { changer, Footer, parts, TitleLine, useAuthor } from "../../frame/parts";
import styles from "./FreeTimes.module.css";

/**
 * The grid shows the hours people can plausibly meet, 6:00 to 21:00 in each
 * viewer's own time zone. Rows are half hours since local midnight.
 */
const FIRST_ROW = 12;
const END_ROW = 42;
const DAY_ROWS = Array.from({ length: END_ROW - FIRST_ROW }, (_, i) => FIRST_ROW + i);
/** Where the grid opens: 8:00, so early mornings and evenings are a scroll away. */
const FIRST_VISIBLE_ROW = 16;

type Day = { y: number; m: number; d: number };

/** The grid's days as plain dates, the same for everyone. */
function daysFrom(startDay: number): Day[] {
  return Array.from({ length: FREE_DAYS }, (_, i) => {
    const t = new Date((startDay + i) * 86_400_000);
    return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate() };
  });
}

/** The slot a cell is, in this viewer's time zone: day `day`, half hour `row`. */
function cellSlot(startDay: number, day: Day, row: number): number {
  const local = new Date(day.y, day.m, day.d, Math.floor(row / 2), (row % 2) * 30);
  return slotAt(startDay, Math.floor(local.getTime() / 60_000));
}

/**
 * When is everyone free? Each person paints their free half hours over a
 * week; the grid darkens where more people are free. Times are stored in
 * UTC and shown in each viewer's own time zone.
 */
export function FreeTimes(props: WidgetProps) {
  const s = () => props.session;
  const change = changer(props, "freetimes");
  const grid = createMemo(() => s().live(props.id, "freetimes"));
  const author = useAuthor(props);

  /** A memo, so the day columns only rebuild when the week moves. */
  const startDay = createMemo(() => grid()?.startDay ?? 0);
  const days = createMemo(() => daysFrom(startDay()));
  const people = createMemo(() => Object.entries(grid()?.people ?? {}));
  const rows = createMemo(() =>
    people().map(([key, p]) => ({ key, name: p.name, hue: p.hue, bits: slotsToBits(p.slots) })),
  );
  const me = () => s().voter();

  /** Your row while you paint; sent once when you let go. */
  const [paint, setPaint] = createSignal<boolean[] | null>(null);
  const mine = createMemo(
    () => paint() ?? rows().find((r) => r.key === me())?.bits ?? Array<boolean>(FREE_SLOTS).fill(false),
  );

  /**
   * Everyone with a lane in the grid, in a steady order: those who answered,
   * then you once you start painting. Each
   * person keeps the same lane in every cell, so their free time reads as
   * one unbroken bar down the day.
   */
  const lanes = createMemo(() => {
    const self = s().peers[s().server.sid];
    const list = rows().map((r) =>
      r.key === me()
        ? { key: r.key, name: self?.name ?? r.name, hue: self?.hue ?? r.hue, me: true, bits: r.bits }
        : { ...r, me: false },
    );
    if (paint()?.some(Boolean) && !list.some((l) => l.me))
      list.push({ key: me(), name: self?.name ?? "you", hue: self?.hue ?? 0, me: true, bits: [] });
    return list;
  });

  /** Each lane's free half hours; yours follow your brush while you paint. */
  const laneBits = createMemo(() => lanes().map((l) => (l.me ? mine() : l.bits)));

  /** How many lanes have any free time: the "everyone" in "everyone's free". */
  const answered = createMemo(() => laneBits().filter((b) => b.some(Boolean)).length);

  /** Who's free in each slot, in lane order. */
  const freeAt = createMemo(() => {
    const out: Array<Array<{ name: string; hue: number; me: boolean }>> = Array.from(
      { length: FREE_SLOTS },
      () => [],
    );
    const bits = laneBits();
    lanes().forEach((l, i) =>
      bits[i]!.forEach((on, slot) => on && out[slot]!.push({ name: l.name, hue: l.hue, me: l.me })),
    );
    return out;
  });

  /** Slots where everyone who answered (two or more) is free. */
  const allFree = createMemo(() => freeAt().map((w) => answered() >= 2 && w.length === answered()));
  const allAt = (slot: number) => slot >= 0 && allFree()[slot] === true;

  /** Days with an all-free slot: their name gets a dot. */
  const allDays = createMemo(
    () =>
      new Set(days().flatMap((d, i) => (DAY_ROWS.some((r) => allAt(cellSlot(startDay(), d, r))) ? [i] : []))),
  );

  const laneOn = (lane: number, slot: number) => slot >= 0 && laneBits()[lane]?.[slot] === true;

  // ------------------------------------------------------------- hover

  /** The cell under the pointer, for the floating list of who's free. */
  const [hover, setHover] = createSignal<{
    day: number;
    row: number;
    x: number;
    y: number;
    below: boolean;
  } | null>(null);
  let wrap: HTMLDivElement | undefined;

  function showHover(e: PointerEvent, day: number, row: number) {
    if (paint() || !wrap) return;
    const cur = hover();
    if (cur && cur.day === day && cur.row === row) return;
    const cell = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const box = wrap.getBoundingClientRect();
    // The board may be scaled to fit the screen; place it in unscaled pixels.
    const scale = box.width / wrap.offsetWidth || 1;
    const x = (cell.left + cell.width / 2 - box.left) / scale;
    const top = (cell.top - box.top) / scale;
    const below = top < 70;
    setHover({ day, row, x, y: below ? (cell.bottom - box.top) / scale : top, below });
  }

  /** The slot most people are free in, shown in the footer. */
  const best = createMemo(() => {
    let top = 0;
    let where: { day: number; row: number } | null = null;
    days().forEach((day, di) => {
      for (const row of DAY_ROWS) {
        const slot = cellSlot(startDay(), day, row);
        const n = slot < 0 ? 0 : freeAt()[slot]!.length;
        if (n > top) {
          top = n;
          where = { day: di, row };
        }
      }
    });
    return where === null ? null : { ...(where as { day: number; row: number }), count: top };
  });

  // ------------------------------------------------------------ paint

  /**
   * Press on a half hour and drag: every cell in the rectangle from there to
   * the pointer turns free (or not, if you started on one that was free).
   */
  function beginPaint(e: PointerEvent, dayIndex: number, row: number) {
    const slot = cellSlot(startDay(), days()[dayIndex]!, row);
    if (props.readOnly || slot < 0 || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const before = [...mine()];
    const to = !before[slot];
    const fill = (d2: number, r2: number) => {
      const next = [...before];
      for (let d = Math.min(dayIndex, d2); d <= Math.max(dayIndex, d2); d++)
        for (let r = Math.min(row, r2); r <= Math.max(row, r2); r++) {
          const at = cellSlot(startDay(), days()[d]!, r);
          if (at >= 0) next[at] = to;
        }
      setPaint(next);
    };
    fill(dayIndex, row);
    s().setPresence({ action: "typing" });
    const over = (ev: PointerEvent) => {
      // The pointer is usually over a person's bar; paint the cell holding it.
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("td[data-day]");
      if (!el || !wrap?.contains(el)) return;
      fill(Number(el.dataset.day), Number(el.dataset.r));
    };
    const end = () => {
      removeEventListener("pointermove", over);
      removeEventListener("pointerup", end);
      removeEventListener("pointercancel", end);
      const bitsNow = paint();
      s().setPresence({ action: null });
      if (bitsNow) void change({ do: "setSlots", slots: bitsToSlots(bitsNow) }).finally(() => setPaint(null));
    };
    addEventListener("pointermove", over);
    addEventListener("pointerup", end);
    addEventListener("pointercancel", end);
  }

  // ------------------------------------------------------------- labels

  const dayLabel = (day: Day) =>
    `${new Date(day.y, day.m, day.d).toLocaleDateString(undefined, { weekday: "short" })} ${day.d}`;
  const timeLabel = (row: number, full = false) =>
    new Date(2000, 0, 1, Math.floor(row / 2), (row % 2) * 30).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: full || row % 2 ? "2-digit" : undefined,
    });
  const range = () => {
    const first = days()[0]!;
    const last = days()[FREE_DAYS - 1]!;
    const fmt = (d: Day) =>
      new Date(d.y, d.m, d.d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `${fmt(first)} – ${fmt(last)}`;
  };
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g, " ");

  let scroller: HTMLDivElement | undefined;

  /** Column widths shared by the day-name table and the scrolling grid. */
  const cols = () => (
    <colgroup>
      <col class={styles.corner} />
      <col span={FREE_DAYS} />
    </colgroup>
  );

  return (
    <WidgetFrame
      {...props}
      kind="freetimes"
      class={[parts.body, styles.free]}
      color={s().color(props.id)}
      label={`Free times by ${author()}: ${s().listTitle(props.id) || "untitled"}, ${rows().length} people`}
      deleteLabel="Delete free times"
    >
      <TitleLine
        id={props.id}
        session={s()}
        readOnly={props.readOnly}
        placeholder={props.readOnly ? "Free times" : "When are we free?"}
        label="Free times title"
        onError={props.onError}
      />

      <div class={styles.bar}>
        <Show when={!props.readOnly}>
          <button
            type="button"
            class={parts.icon}
            aria-label="Earlier week"
            onClick={() => void change({ do: "setStart", day: startDay() - 7 })}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M10 3.5 5.5 8l4.5 4.5" />
            </svg>
          </button>
        </Show>
        <span class={styles.range}>{range()}</span>
        <Show when={!props.readOnly}>
          <button
            type="button"
            class={parts.icon}
            aria-label="Later week"
            onClick={() => void change({ do: "setStart", day: startDay() + 7 })}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M6 3.5 10.5 8 6 12.5" />
            </svg>
          </button>
        </Show>
        <span class={styles.zone} title="Times are in your time zone">
          {zone}
        </span>
      </div>

      <div class={styles.wrap} ref={(el) => (wrap = el)}>
        {/* The day names sit outside the scroller, so nothing scrolls behind them. */}
        <div class={styles.head} aria-hidden="true">
          <table class={styles.table}>
            {cols()}
            <thead>
              <tr>
                <th />
                <For each={days()}>
                  {(day, i) => (
                    <th class={styles.day} data-all={allDays().has(i())}>
                      {dayLabel(day)}
                    </th>
                  )}
                </For>
              </tr>
            </thead>
          </table>
        </div>
        <div
          class={styles.scroller}
          data-nodrag
          onScroll={() => setHover(null)}
          onPointerLeave={() => setHover(null)}
          ref={(el) => {
            scroller = el;
            // Open at 8:00 once the rows are laid out.
            requestAnimationFrame(() => {
              const row = scroller?.querySelector<HTMLElement>(`[data-row-index="${FIRST_VISIBLE_ROW}"]`);
              if (scroller && row) scroller.scrollTop = row.offsetTop;
            });
          }}
        >
          <table class={styles.table} aria-label={`Free times, ${range()}`}>
            {cols()}
            <tbody>
              <For each={DAY_ROWS}>
                {(row) => (
                  <tr data-row-index={row} data-hour={row % 2 === 0}>
                    <th class={styles.time} scope="row">
                      <Show when={row % 2 === 0}>{timeLabel(row)}</Show>
                    </th>
                    <For each={days()}>
                      {(day, dayIndex) => {
                        const slot = () => cellSlot(startDay(), day, row);
                        const above = () => (row > FIRST_ROW ? cellSlot(startDay(), day, row - 1) : -1);
                        const below = () => (row < END_ROW - 1 ? cellSlot(startDay(), day, row + 1) : -1);
                        const who = () => (slot() < 0 ? [] : freeAt()[slot()]!);
                        const isMine = () => slot() >= 0 && mine()[slot()] === true;
                        const all = () => allAt(slot());
                        return (
                          <td
                            class={styles.cell}
                            data-slot={slot()}
                            data-day={dayIndex()}
                            data-r={row}
                            data-mine={isMine()}
                            data-out={slot() < 0}
                            data-free={who().length > 0}
                            data-all={all()}
                            data-all-top={all() && !allAt(above())}
                            data-all-end={all() && !allAt(below())}
                            data-readonly={props.readOnly}
                            style={{ "--heat": answered() ? who().length / answered() : 0 }}
                            aria-label={`${dayLabel(day)} ${timeLabel(row)}: ${
                              who().length === 0
                                ? "nobody free"
                                : all()
                                  ? "everyone free"
                                  : who()
                                      .map((p) => p.name)
                                      .join(", ")
                            }`}
                            onPointerMove={(e) => showHover(e, dayIndex(), row)}
                            onPointerDown={(e) => {
                              setHover(null);
                              beginPaint(e, dayIndex(), row);
                            }}
                          >
                            <span class={styles.lanes} aria-hidden="true">
                              <For each={lanes()}>
                                {(l, i) => {
                                  const on = () => laneOn(i(), slot());
                                  return (
                                    <span
                                      class={styles.lane}
                                      data-on={on()}
                                      data-top={on() && !laneOn(i(), above())}
                                      data-end={on() && !laneOn(i(), below())}
                                      style={on() ? { "--c": personColor(l.hue) } : undefined}
                                    />
                                  );
                                }}
                              </For>
                            </span>
                          </td>
                        );
                      }}
                    </For>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
        <Show when={hover()}>
          {(h) => {
            const who = () => {
              const slot = cellSlot(startDay(), days()[h().day]!, h().row);
              return slot < 0 ? [] : freeAt()[slot]!;
            };
            return (
              <div
                class={styles.pop}
                role="tooltip"
                data-below={h().below}
                style={{ left: `${h().x}px`, top: `${h().y}px` }}
              >
                <p class={styles.popTime}>
                  {dayLabel(days()[h().day]!)} · {timeLabel(h().row, true)}
                </p>
                <Show when={who().length > 0} fallback={<p class={styles.popEmpty}>Nobody's free yet</p>}>
                  <ul class={styles.popList}>
                    <For each={who()}>
                      {(p) => (
                        <li class={styles.popPerson} style={personVars(p.hue)}>
                          <span class={styles.swatch} aria-hidden="true" />
                          {p.name}
                          {p.me ? " (you)" : ""}
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
              </div>
            );
          }}
        </Show>
      </div>

      <Footer
        id={props.id}
        session={s()}
        readOnly={props.readOnly}
        width={props.rect.w}
        author={author()}
        colorLabel="Free times color"
        onError={props.onError}
        info={
          <>
            <span class={styles.people} aria-label={`${rows().length} people answered`}>
              <For each={rows().slice(0, 8)}>
                {(r) => <span class={parts.dot} style={personVars(r.hue)} title={r.name} />}
              </For>
            </span>
            {/* When everyone lines up the grid already shows it in red; only hint at the next best. */}
            <Show when={best() && best()!.count < answered() ? best() : undefined}>
              {(b) => (
                <span class={styles.best}>
                  best: {dayLabel(days()[b().day]!)} {timeLabel(b().row)} ({b().count} of {answered()})
                </span>
              )}
            </Show>
          </>
        }
        tools={
          <Show when={mine().some(Boolean)}>
            <button
              type="button"
              class={parts.chip}
              onClick={() =>
                void change({ do: "setSlots", slots: bitsToSlots(Array(FREE_SLOTS).fill(false)) })
              }
            >
              Clear mine
            </button>
          </Show>
        }
      />
    </WidgetFrame>
  );
}
