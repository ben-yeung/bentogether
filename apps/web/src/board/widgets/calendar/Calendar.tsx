import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js";
import { EVENT_TITLE_MAX, randomId, type CalendarEvent, type CalendarMode } from "@bentogether/shared";
import { personVars } from "../../../lib/identity";
import {
  addDays,
  addMonths,
  clock,
  dateOfMinute,
  fromDateStr,
  minuteOf,
  monthGrid,
  sameMonth,
  startOfWeek,
  timeOfMinute,
  toDateStr,
} from "../../../lib/dates";
import { WidgetFrame, type WidgetProps } from "../../frame/WidgetFrame";
import { changer, focusOnMount, Footer, parts, TitleLine, useAuthor, shownName } from "../../frame/parts";
import styles from "./Calendar.module.css";

type View = { mode: CalendarMode; anchor: string };
type Draft = {
  eventId: string | null;
  title: string;
  date: string;
  allDay: boolean;
  start: string;
  end: string;
};

const MODES: Array<{ mode: CalendarMode; label: string }> = [
  { mode: "month", label: "Month" },
  { mode: "week", label: "Week" },
  { mode: "day", label: "Day" },
];

/** Which local day an event shows on. */
const dayOf = (e: CalendarEvent) => e.day ?? dateOfMinute(e.start ?? 0);

/**
 * A shared calendar with month, week and day views. Editors move the view
 * for everyone; viewers can look around on their own and jump back. All-day
 * events are plain dates; timed ones show in each viewer's own time.
 */
export function Calendar(props: WidgetProps) {
  const s = () => props.session;
  const change = changer(props, "calendar");
  const cal = createMemo(() => s().live(props.id, "calendar"));
  const author = useAuthor(props);
  const today = () => toDateStr(new Date());

  // ------------------------------------------------------------- view

  /** A viewer's own place in the calendar; null follows the shared view. */
  const [local, setLocal] = createSignal<View | null>(null);
  const shared = (): View => cal()?.view ?? { mode: "month", anchor: today() };
  const view = () => local() ?? shared();

  function go(next: View) {
    if (props.readOnly) setLocal(next);
    else void change({ do: "setView", mode: next.mode, anchor: next.anchor });
  }

  function step(n: number) {
    const v = view();
    const anchor =
      v.mode === "month" ? addMonths(v.anchor, n) : addDays(v.anchor, v.mode === "week" ? 7 * n : n);
    go({ mode: v.mode, anchor });
  }

  const heading = createMemo(() => {
    const v = view();
    const d = fromDateStr(v.anchor);
    if (v.mode === "month") return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    if (v.mode === "day")
      return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    const first = fromDateStr(startOfWeek(v.anchor));
    const last = fromDateStr(addDays(startOfWeek(v.anchor), 6));
    const fmt = (x: Date) => x.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `${fmt(first)} – ${fmt(last)}`;
  });

  // ----------------------------------------------------------- events

  /** Events by the local day they show on, all-day first, then by time. */
  const byDay = createMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of cal()?.events ?? []) {
      const d = dayOf(e);
      const list = map.get(d) ?? [];
      list.push(e);
      map.set(d, list);
    }
    for (const list of map.values())
      list.sort((a, b) => (a.start ?? -1) - (b.start ?? -1) || a.title.localeCompare(b.title));
    return map;
  });
  const eventsOn = (date: string) => byDay().get(date) ?? [];

  // ------------------------------------------------------------- form

  const [draft, setDraft] = createSignal<Draft | null>(null);

  /** Where "+" starts a new event: today in this month's view, else the day in view. */
  const newEventDate = () => {
    const v = view();
    return v.mode === "month" && sameMonth(v.anchor, today()) ? today() : v.anchor;
  };

  function openNew(date: string) {
    if (props.readOnly) return;
    setDraft({ eventId: null, title: "", date, allDay: false, start: "09:00", end: "10:00" });
    s().setPresence({ action: "typing" });
  }

  function openEdit(e: CalendarEvent) {
    if (props.readOnly) return;
    setDraft({
      eventId: e.id,
      title: e.title,
      date: dayOf(e),
      allDay: e.day !== null,
      start: e.start !== null ? timeOfMinute(e.start) : "09:00",
      end: e.end !== null ? timeOfMinute(e.end) : "10:00",
    });
    s().setPresence({ action: "typing" });
  }

  function closeForm() {
    setDraft(null);
    s().setPresence({ action: null });
  }

  function save(e: SubmitEvent) {
    e.preventDefault();
    const d = draft();
    if (!d) return;
    const title = d.title.trim();
    if (!title) {
      props.onError("Give the event a name.");
      return;
    }
    let when: { day: string | null; start: number | null; end: number | null };
    if (d.allDay) when = { day: d.date, start: null, end: null };
    else {
      const start = minuteOf(d.date, d.start);
      let end = minuteOf(d.date, d.end);
      // Ending "before" it starts means it runs past midnight.
      if (end < start) end += 24 * 60;
      when = { day: null, start, end };
    }
    const eventId = d.eventId ?? randomId(12);
    void change({ do: d.eventId ? "editEvent" : "addEvent", eventId, title, ...when });
    closeForm();
  }

  function remove() {
    const d = draft();
    if (d?.eventId) void change({ do: "removeEvent", eventId: d.eventId });
    closeForm();
  }

  // ------------------------------------------------------------ parts

  const Chip = (p: { event: CalendarEvent; long?: boolean }) => (
    <button
      type="button"
      class={styles.chip}
      data-allday={p.event.day !== null}
      style={personVars(p.event.hue)}
      title={`${p.event.title}${p.event.start !== null ? `, ${clock(p.event.start)}–${clock(p.event.end ?? p.event.start)}` : ", all day"} (${shownName(p.event.by)})`}
      aria-disabled={props.readOnly ? "true" : undefined}
      onClick={(ev) => {
        ev.stopPropagation();
        openEdit(p.event);
      }}
    >
      <Show when={p.event.start !== null}>
        <span class={styles.chipTime}>
          {clock(p.event.start!)}
          {p.long ? `–${clock(p.event.end ?? p.event.start!)}` : ""}
        </span>
      </Show>
      <span class={styles.chipTitle}>{p.event.title}</span>
    </button>
  );

  const weekdays = createMemo(() =>
    Array.from({ length: 7 }, (_, i) =>
      fromDateStr(addDays(startOfWeek(view().anchor), i)).toLocaleDateString(undefined, { weekday: "short" }),
    ),
  );

  return (
    <WidgetFrame
      {...props}
      kind="calendar"
      class={[parts.body, styles.calendar]}
      color={s().color(props.id)}
      label={`Calendar by ${author()}: ${s().listTitle(props.id) || "untitled"}, ${heading()}`}
      deleteLabel="Delete calendar"
    >
      <TitleLine
        id={props.id}
        session={s()}
        readOnly={props.readOnly}
        placeholder={props.readOnly ? "Calendar" : "Name this calendar"}
        label="Calendar title"
        onError={props.onError}
      />

      <div class={styles.bar}>
        <button type="button" class={parts.icon} aria-label="Previous" onClick={() => step(-1)}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M10 3.5 5.5 8l4.5 4.5" />
          </svg>
        </button>
        <span class={styles.heading} aria-live="polite">
          {heading()}
        </span>
        <button type="button" class={parts.icon} aria-label="Next" onClick={() => step(1)}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M6 3.5 10.5 8 6 12.5" />
          </svg>
        </button>
        <button type="button" class={parts.chip} onClick={() => go({ mode: view().mode, anchor: today() })}>
          Today
        </button>
        <span class={styles.spacer} />
        <Show when={local()}>
          <button type="button" class={parts.chip} onClick={() => setLocal(null)}>
            Back to shared view
          </button>
        </Show>
        <div class={styles.modes} role="group" aria-label="View">
          <For each={MODES}>
            {(m) => (
              <button
                type="button"
                class={styles.mode}
                aria-pressed={view().mode === m.mode ? "true" : "false"}
                onClick={() => go({ mode: m.mode, anchor: view().anchor })}
              >
                {m.label}
              </button>
            )}
          </For>
        </div>
        <Show when={!props.readOnly}>
          <button
            type="button"
            class={parts.icon}
            aria-label="Add an event"
            title="Add an event"
            onClick={() => openNew(newEventDate())}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M8 3.5v9M3.5 8h9" />
            </svg>
          </button>
        </Show>
      </div>

      <div class={styles.stage} data-nodrag>
        <Switch>
          <Match when={view().mode === "month"}>
            <div class={styles.month}>
              <For each={weekdays()}>{(w) => <span class={styles.weekday}>{w}</span>}</For>
              <For each={monthGrid(view().anchor)}>
                {(date) => (
                  <div
                    class={styles.cell}
                    data-other={!sameMonth(date, view().anchor)}
                    data-today={date === today()}
                    role="button"
                    tabindex="-1"
                    aria-label={`${fromDateStr(date).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}, ${eventsOn(date).length} events`}
                    onClick={() => go({ mode: "day", anchor: date })}
                  >
                    <span class={styles.num}>{fromDateStr(date).getDate()}</span>
                    <For each={eventsOn(date).slice(0, 2)} keyed={(e) => e.id}>
                      {(e) => <Chip event={e()} />}
                    </For>
                    <Show when={eventsOn(date).length > 2}>
                      <span class={styles.more}>+{eventsOn(date).length - 2}</span>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Match>
          <Match when={view().mode === "week"}>
            <div class={styles.week}>
              <For each={Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(view().anchor), i))}>
                {(date) => (
                  <div class={styles.col} data-today={date === today()}>
                    <button
                      type="button"
                      class={styles.colHead}
                      onClick={() => go({ mode: "day", anchor: date })}
                    >
                      <span>{fromDateStr(date).toLocaleDateString(undefined, { weekday: "short" })}</span>
                      <span class={styles.colNum}>{fromDateStr(date).getDate()}</span>
                    </button>
                    <div class={styles.colBody}>
                      <For each={eventsOn(date)} keyed={(e) => e.id}>
                        {(e) => <Chip event={e()} />}
                      </For>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Match>
          <Match when={view().mode === "day"}>
            <ul class={[parts.scroll, styles.day]} aria-label="Events">
              <For each={eventsOn(view().anchor)} keyed={(e) => e.id}>
                {(e) => (
                  <li>
                    <Chip event={e()} long />
                  </li>
                )}
              </For>
              <Show when={eventsOn(view().anchor).length === 0}>
                <li class={parts.muted}>Nothing planned.</li>
              </Show>
              <Show when={!props.readOnly}>
                <li>
                  <button type="button" class={parts.chip} onClick={() => openNew(view().anchor)}>
                    + Add an event
                  </button>
                </li>
              </Show>
            </ul>
          </Match>
        </Switch>

        <Show when={draft()}>
          {(d) => (
            <form class={styles.form} onSubmit={save} aria-label={d().eventId ? "Edit event" : "New event"}>
              <input
                ref={focusOnMount}
                class={[parts.plain, styles.formTitle]}
                value={d().title}
                placeholder="Event name"
                maxlength={EVENT_TITLE_MAX}
                aria-label="Event name"
                onInput={(e) => setDraft({ ...d(), title: e.currentTarget.value })}
                onKeyDown={(e) => {
                  if (e.key === "Escape") closeForm();
                }}
              />
              <div class={styles.formRow}>
                <input
                  type="date"
                  class={styles.field}
                  value={d().date}
                  aria-label="Date"
                  onInput={(e) => e.currentTarget.value && setDraft({ ...d(), date: e.currentTarget.value })}
                />
                <label class={styles.check}>
                  <input
                    type="checkbox"
                    checked={d().allDay}
                    onChange={(e) => setDraft({ ...d(), allDay: e.currentTarget.checked })}
                  />
                  All day
                </label>
              </div>
              <Show when={!d().allDay}>
                <div class={styles.formRow}>
                  <input
                    type="time"
                    class={styles.field}
                    value={d().start}
                    aria-label="Starts"
                    onInput={(e) =>
                      e.currentTarget.value && setDraft({ ...d(), start: e.currentTarget.value })
                    }
                  />
                  <span class={parts.muted}>to</span>
                  <input
                    type="time"
                    class={styles.field}
                    value={d().end}
                    aria-label="Ends"
                    onInput={(e) => e.currentTarget.value && setDraft({ ...d(), end: e.currentTarget.value })}
                  />
                </div>
              </Show>
              <div class={styles.formActions}>
                <Show when={d().eventId}>
                  <button type="button" class={parts.chip} onClick={remove}>
                    Delete
                  </button>
                </Show>
                <span class={styles.spacer} />
                <button type="button" class={parts.chip} onClick={closeForm}>
                  Cancel
                </button>
                <button type="submit" class={styles.save}>
                  Save
                </button>
              </div>
            </form>
          )}
        </Show>
      </div>

      <Footer
        id={props.id}
        session={s()}
        readOnly={props.readOnly}
        width={props.rect.w}
        author={author()}
        colorLabel="Calendar color"
        onError={props.onError}
      />
    </WidgetFrame>
  );
}
