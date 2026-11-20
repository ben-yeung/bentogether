import {
  ASK_PEOPLE_MAX,
  ASKS_PER_PERSON_MAX,
  CALENDAR_EVENTS_MAX,
  FREE_HEX,
  FREE_PEOPLE_MAX,
  IDEAS_MAX,
  POLL_OPTIONS_MAX,
  POLL_VOTERS_MAX,
  TIMER_DEFAULT_MS,
  TIMER_MAX_MS,
  type AskPerson,
  type CalendarEvent,
  type FramedKind,
  type FramedWidget,
  type RejectCode,
  type Widget,
  type WidgetChange,
} from "./protocol";
import { shiftSlots } from "./freetimes";

/** Who is making a change, and when (server time). */
export type ChangeCtx = { name: string; hue: number; voter: string; now: number };
export type Rejection = { code: RejectCode; message: string };

const no = (code: RejectCode, message: string): Rejection => ({ code, message });
const gone = (what: string) => no("not_found", `That ${what} is gone.`);

/** Changes a viewer may make: their poll vote and their Ideas upvotes. */
export function viewerMay(change: WidgetChange): boolean {
  return (
    (change.kind === "poll" && change.do === "vote") || (change.kind === "ideas" && change.do === "upvote")
  );
}

/** What a new widget of a framed kind starts with. */
export function blankFields(kind: FramedKind, now: number) {
  switch (kind) {
    case "timer":
      return { kind, duration: TIMER_DEFAULT_MS, endsAt: null, left: TIMER_DEFAULT_MS } as const;
    case "poll":
      return { kind, multi: false, options: [], votes: {} } as const;
    case "ideas":
      return { kind, ideas: [] } as const;
    case "asks":
      return { kind, people: [] } as const;
    case "freetimes":
      return { kind, startDay: Math.floor(now / 86_400_000), people: {} } as const;
    case "calendar":
      return {
        kind,
        view: { mode: "month", anchor: new Date(now).toISOString().slice(0, 10) },
        events: [],
      } as const;
  }
}

/** Time left on a Timer at `now`, in ms. */
export function timerLeft(w: { endsAt: number | null; left: number }, now: number): number {
  return w.endsAt === null ? w.left : Math.max(0, w.endsAt - now);
}

/**
 * Applies one change to a Timer, Poll, Ideas, Asks, Free times or Calendar.
 * Pure: the server decides with it, and the sender's screen runs it on its
 * own changes in flight so they show at once. Returns the new widget
 * (a copy) or why it can't.
 */
export function applyWidgetChange(w: Widget, change: WidgetChange, ctx: ChangeCtx): FramedWidget | Rejection {
  if (w.kind !== change.kind) return no("invalid", "That change doesn't fit this widget.");
  switch (change.kind) {
    case "timer": {
      if (w.kind !== "timer") break;
      const left = timerLeft(w, ctx.now);
      switch (change.do) {
        case "start":
          if (w.endsAt !== null && left > 0) return w;
          // Finished (or never started): run from the top again.
          return { ...w, endsAt: ctx.now + (left > 0 ? left : w.duration), left: 0 };
        case "pause":
          if (w.endsAt === null) return w;
          return { ...w, endsAt: null, left };
        case "reset":
          return { ...w, endsAt: null, left: w.duration };
        case "set":
          return { ...w, duration: change.ms, endsAt: null, left: change.ms };
        case "add": {
          const next = Math.min(TIMER_MAX_MS, Math.max(0, left + change.ms));
          return w.endsAt === null ? { ...w, left: next } : { ...w, endsAt: ctx.now + next };
        }
      }
      break;
    }

    case "poll": {
      if (w.kind !== "poll") break;
      switch (change.do) {
        case "addOption":
          if (w.options.some((o) => o.id === change.optionId))
            return no("exists", "That option is already there.");
          if (w.options.length >= POLL_OPTIONS_MAX) return no("limit", "A poll holds 12 options.");
          return { ...w, options: [...w.options, { id: change.optionId, text: change.text }] };
        case "editOption":
          if (!w.options.some((o) => o.id === change.optionId)) return gone("option");
          return {
            ...w,
            options: w.options.map((o) => (o.id === change.optionId ? { ...o, text: change.text } : o)),
          };
        case "removeOption": {
          if (!w.options.some((o) => o.id === change.optionId)) return gone("option");
          const votes = Object.fromEntries(
            Object.entries(w.votes).map(([k, vote]) => [
              k,
              { ...vote, picks: vote.picks.filter((p) => p !== change.optionId) },
            ]),
          );
          return { ...w, options: w.options.filter((o) => o.id !== change.optionId), votes };
        }
        case "vote": {
          const valid = [...new Set(change.picks)].filter((p) => w.options.some((o) => o.id === p));
          const picks = w.multi ? valid : valid.slice(-1);
          const votes = { ...w.votes };
          if (picks.length === 0) delete votes[ctx.voter];
          else {
            if (!votes[ctx.voter] && Object.keys(votes).length >= POLL_VOTERS_MAX)
              return no("limit", "This poll has all the votes it can hold.");
            votes[ctx.voter] = { name: ctx.name, hue: ctx.hue, picks };
          }
          return { ...w, votes };
        }
        case "setMulti": {
          if (change.multi || w.multi === change.multi) return { ...w, multi: change.multi };
          // Down to one pick each: keep everyone's latest.
          const votes = Object.fromEntries(
            Object.entries(w.votes).map(([k, vote]) => [k, { ...vote, picks: vote.picks.slice(-1) }]),
          );
          return { ...w, multi: false, votes };
        }
        case "clearVotes":
          return { ...w, votes: {} };
      }
      break;
    }

    case "ideas": {
      if (w.kind !== "ideas") break;
      const has = w.ideas.some((i) => i.id === change.ideaId);
      switch (change.do) {
        case "add":
          if (has) return no("exists", "That idea is already there.");
          if (w.ideas.length >= IDEAS_MAX) return no("limit", "This board holds 100 ideas.");
          return {
            ...w,
            ideas: [
              ...w.ideas,
              { id: change.ideaId, text: change.text, by: ctx.name, hue: ctx.hue, at: ctx.now, votes: [] },
            ],
          };
        case "edit":
          if (!has) return gone("idea");
          return {
            ...w,
            ideas: w.ideas.map((i) => (i.id === change.ideaId ? { ...i, text: change.text } : i)),
          };
        case "remove":
          if (!has) return gone("idea");
          return { ...w, ideas: w.ideas.filter((i) => i.id !== change.ideaId) };
        case "upvote":
          if (!has) return gone("idea");
          return {
            ...w,
            ideas: w.ideas.map((i) => {
              if (i.id !== change.ideaId) return i;
              const others = i.votes.filter((k) => k !== ctx.voter);
              return { ...i, votes: change.on ? [...others, ctx.voter] : others };
            }),
          };
      }
      break;
    }

    case "asks": {
      if (w.kind !== "asks") break;
      const person = w.people.find((p) => p.id === change.personId);
      const withPerson = (fn: (p: AskPerson) => Partial<AskPerson>) =>
        w.people.map((p) => (p.id === change.personId ? { ...p, ...fn(p) } : p));
      switch (change.do) {
        case "addPerson":
          if (person) return no("exists", "They're already here.");
          if (w.people.length >= ASK_PEOPLE_MAX) return no("limit", "This holds 16 people.");
          return { ...w, people: [...w.people, { id: change.personId, name: change.name, asks: [] }] };
        case "renamePerson":
          if (!person) return gone("person");
          return { ...w, people: withPerson(() => ({ name: change.name })) };
        case "removePerson":
          if (!person) return gone("person");
          return { ...w, people: w.people.filter((p) => p.id !== change.personId) };
        case "addAsk":
          if (!person) return gone("person");
          if (person.asks.some((a) => a.id === change.askId))
            return no("exists", "That ask is already there.");
          if (person.asks.length >= ASKS_PER_PERSON_MAX) return no("limit", "One person holds 50 asks.");
          return {
            ...w,
            people: withPerson((p) => ({
              asks: [
                ...p.asks,
                { id: change.askId, text: change.text, by: ctx.name, hue: ctx.hue, at: ctx.now, done: false },
              ],
            })),
          };
        case "checkAsk":
        case "removeAsk": {
          if (!person) return gone("person");
          if (!person.asks.some((a) => a.id === change.askId)) return gone("ask");
          const next = (p: AskPerson) =>
            change.do === "removeAsk"
              ? p.asks.filter((a) => a.id !== change.askId)
              : p.asks.map((a) => (a.id === change.askId ? { ...a, done: change.done } : a));
          return { ...w, people: withPerson((p) => ({ asks: next(p) })) };
        }
      }
      break;
    }

    case "freetimes": {
      if (w.kind !== "freetimes") break;
      switch (change.do) {
        case "setSlots": {
          const people = { ...w.people };
          const empty = /^0*$/.test(change.slots);
          if (empty) delete people[ctx.voter];
          else {
            if (!people[ctx.voter] && Object.keys(people).length >= FREE_PEOPLE_MAX)
              return no("limit", "This grid holds 40 people.");
            people[ctx.voter] = { name: ctx.name, hue: ctx.hue, slots: change.slots };
          }
          return { ...w, people };
        }
        case "setStart": {
          const by = change.day - w.startDay;
          if (by === 0) return w;
          const people = Object.fromEntries(
            Object.entries(w.people)
              .map(([k, p]) => [k, { ...p, slots: shiftSlots(p.slots, by * 48) }] as const)
              .filter(([, p]) => !/^0*$/.test(p.slots)),
          );
          return { ...w, startDay: change.day, people };
        }
      }
      break;
    }

    case "calendar": {
      if (w.kind !== "calendar") break;
      switch (change.do) {
        case "addEvent":
        case "editEvent": {
          const timed = change.start !== null && change.end !== null;
          if (
            (change.day === null) === !timed ||
            (change.day !== null && (change.start ?? change.end) !== null)
          )
            return no("invalid", "An event is either all day or has a start and end.");
          if (timed && change.end! < change.start!) return no("invalid", "It ends before it starts.");
          const has = w.events.some((e) => e.id === change.eventId);
          const event: CalendarEvent = {
            id: change.eventId,
            title: change.title,
            day: change.day,
            start: change.start,
            end: change.end,
            by: ctx.name,
            hue: ctx.hue,
          };
          if (change.do === "addEvent") {
            if (has) return no("exists", "That event is already there.");
            if (w.events.length >= CALENDAR_EVENTS_MAX) return no("limit", "A calendar holds 200 events.");
            return { ...w, events: [...w.events, event] };
          }
          if (!has) return gone("event");
          return {
            ...w,
            events: w.events.map((e) => (e.id === change.eventId ? { ...event, by: e.by, hue: e.hue } : e)),
          };
        }
        case "removeEvent":
          if (!w.events.some((e) => e.id === change.eventId)) return gone("event");
          return { ...w, events: w.events.filter((e) => e.id !== change.eventId) };
        case "setView":
          return { ...w, view: { mode: change.mode, anchor: change.anchor } };
      }
      break;
    }
  }
  return no("invalid", "That change doesn't fit this widget.");
}

/** Hex of an empty free-times row. */
export const NO_SLOTS = "0".repeat(FREE_HEX);
