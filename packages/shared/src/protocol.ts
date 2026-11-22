import * as v from "valibot";
import { GRID_COLS, GRID_MAX_ROWS } from "./grid";
import type { TextOp } from "./text";

/**
 * Wire protocol between a browser and a box's Durable Object, over one
 * WebSocket. JSON messages, discriminated by `t`. Everything a client sends
 * is validated with these schemas before the server acts on it.
 */
export const PROTOCOL_VERSION = 3;

// ---------------------------------------------------------------- primitives

export const ID_PATTERN = /^[a-z0-9]{8,24}$/;
export const Id = v.pipe(v.string(), v.regex(ID_PATTERN));

export const NOTE_COLORS = ["tamago", "sake", "edamame", "ume", "nori", "shiso"] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];
export const NoteColorSchema = v.picklist(NOTE_COLORS);

export const NOTE_TEXT_MAX = 2000;

/**
 * How long a deleted widget can be brought back by whoever deleted it. Kept
 * in the box's memory only: if it sleeps in between, undo says it's too late.
 */
export const UNDO_MS = 15_000;

/** Text size of a note, shared by everyone so line wraps match. */
export const TEXT_SIZES = ["s", "m", "l", "xl"] as const;
export type TextSize = (typeof TEXT_SIZES)[number];
export const TextSizeSchema = v.picklist(TEXT_SIZES);
export const DEFAULT_TEXT_SIZE: TextSize = "m";

/** `createdBy` of notes the box made itself (starter notes). */
export const SYSTEM_AUTHOR = "benTogether";
export const NAME_MAX = 24;

/**
 * Who made a widget, as their voter key (see voterKey): it decides who may
 * delete it without sending anyone's device id. Missing on widgets the box
 * made itself and ones saved before it existed; only the owner deletes those.
 */
const CreatorKey = v.optional(v.pipe(v.string(), v.regex(/^[a-z0-9]{4,16}$/)));

const Int = (min: number, max: number) => v.pipe(v.number(), v.integer(), v.minValue(min), v.maxValue(max));
const Coord = (max: number) => v.pipe(v.number(), v.finite(), v.minValue(-1), v.maxValue(max + 1));

export const RectSchema = v.object({
  x: Int(0, GRID_COLS - 1),
  y: Int(0, GRID_MAX_ROWS - 1),
  w: Int(1, GRID_COLS),
  h: Int(1, GRID_MAX_ROWS),
});

export const TITLE_MAX = 60;
export const TitleSchema = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(TITLE_MAX));
export const NameSchema = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(NAME_MAX));
export const HueSchema = v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(360));

// ------------------------------------------------------------------- widgets

export const NoteWidgetSchema = v.object({
  id: Id,
  kind: v.literal("note"),
  ...RectSchema.entries,
  text: v.pipe(v.string(), v.maxLength(NOTE_TEXT_MAX)),
  color: NoteColorSchema,
  /** Optional on the wire so notes saved before sizes existed still parse. */
  size: v.optional(TextSizeSchema),
  /**
   * How many edits the text has had; typed edits name the version they were
   * made against (see text.ts). Missing on notes nobody has typed in yet.
   */
  tv: v.optional(v.number()),
  createdBy: v.string(),
  creatorKey: CreatorKey,
  createdAt: v.number(),
  updatedAt: v.number(),
});
export type NoteWidget = v.InferOutput<typeof NoteWidgetSchema>;

/** Longest heading on a list widget (a To-do's title line). */
export const WIDGET_TITLE_MAX = 60;
const WidgetTitle = v.pipe(v.string(), v.maxLength(WIDGET_TITLE_MAX));

/**
 * Items a To-do holds. Every change rewrites the whole widget row and
 * is broadcast whole, so this keeps one To-do well under the message size.
 */
export const TODO_ITEMS_MAX = 100;
export const TODO_TEXT_MAX = 160;
const TodoText = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(TODO_TEXT_MAX));

export const TodoItemSchema = v.object({
  id: Id,
  text: v.pipe(v.string(), v.maxLength(TODO_TEXT_MAX)),
  done: v.boolean(),
  /** Who added it, by name. */
  by: v.string(),
  at: v.number(),
});
export type TodoItem = v.InferOutput<typeof TodoItemSchema>;

export const TodoWidgetSchema = v.object({
  id: Id,
  kind: v.literal("todo"),
  ...RectSchema.entries,
  title: WidgetTitle,
  color: NoteColorSchema,
  items: v.array(TodoItemSchema),
  createdBy: v.string(),
  creatorKey: CreatorKey,
  createdAt: v.number(),
  updatedAt: v.number(),
});
export type TodoWidget = v.InferOutput<typeof TodoWidgetSchema>;

/**
 * Currencies a Budget can show. Amounts are always whole hundredths of the
 * major unit, whatever the currency, so switching currency keeps the number
 * (500 stays 500) and only the symbol and decimals change.
 */
export const CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "CAD",
  "AUD",
  "NZD",
  "CHF",
  "CNY",
  "HKD",
  "SGD",
  "KRW",
  "INR",
  "MXN",
  "BRL",
  "SEK",
] as const;
export type Currency = (typeof CURRENCIES)[number];
export const CurrencySchema = v.picklist(CURRENCIES);
export const DEFAULT_CURRENCY: Currency = "USD";

/** Largest amount a Budget holds either way: 10 billion, in hundredths. */
export const BUDGET_AMOUNT_MAX = 1_000_000_000_000;
/** Recent changes a Budget remembers, newest first. */
export const BUDGET_LOG_MAX = 10;
const Amount = Int(-BUDGET_AMOUNT_MAX, BUDGET_AMOUNT_MAX);

export const BudgetLogSchema = v.object({
  /** "adjust" is a +/− click or a typed amount; "set" replaces the total. */
  do: v.picklist(["adjust", "set"]),
  /** The change for "adjust", the new total for "set". */
  amount: v.number(),
  by: v.string(),
  hue: v.number(),
  at: v.number(),
});
export type BudgetLog = v.InferOutput<typeof BudgetLogSchema>;

export const BudgetWidgetSchema = v.object({
  id: Id,
  kind: v.literal("budget"),
  ...RectSchema.entries,
  title: WidgetTitle,
  color: NoteColorSchema,
  currency: CurrencySchema,
  /** What's left, in hundredths. Can go below zero. */
  amount: v.number(),
  log: v.array(BudgetLogSchema),
  createdBy: v.string(),
  creatorKey: CreatorKey,
  createdAt: v.number(),
  updatedAt: v.number(),
});
export type BudgetWidget = v.InferOutput<typeof BudgetWidgetSchema>;

/*
 * The kinds below share one frame (title, color, author) and one way to
 * change them: a `change` op checked by `applyWidgetChange` (changes.ts),
 * which the server and the sender's own screen both run.
 */
const Stamp = { createdBy: v.string(), creatorKey: CreatorKey, createdAt: v.number(), updatedAt: v.number() };
const Frame = { id: Id, ...RectSchema.entries, title: WidgetTitle, color: NoteColorSchema };

/**
 * Who someone is in a poll or a free-times grid: a hash of their device id
 * and the bento, so votes follow a person across tabs without the device id
 * itself (which carries their role) ever being sent to anyone else.
 */
export const VOTER_PATTERN = /^[a-z0-9]{4,16}$/;
const Hue = v.number();

// Timer ---------------------------------------------------------------------

/** Longest a Timer runs: a day. */
export const TIMER_MAX_MS = 24 * 60 * 60 * 1000;
export const TIMER_DEFAULT_MS = 5 * 60 * 1000;
const Ms = Int(0, TIMER_MAX_MS);

export const TimerWidgetSchema = v.object({
  ...Frame,
  kind: v.literal("timer"),
  /** What reset goes back to. */
  duration: v.number(),
  /** Server time it reaches zero, while it runs; null while stopped. */
  endsAt: v.nullable(v.number()),
  /** Time left while stopped. */
  left: v.number(),
  ...Stamp,
});
export type TimerWidget = v.InferOutput<typeof TimerWidgetSchema>;

// Poll ----------------------------------------------------------------------

export const POLL_OPTIONS_MAX = 12;
export const POLL_OPTION_MAX = 80;
export const POLL_VOTERS_MAX = 200;
const OptionText = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(POLL_OPTION_MAX));

export const PollOptionSchema = v.object({ id: Id, text: v.string() });
export const PollVoteSchema = v.object({ name: v.string(), hue: Hue, picks: v.array(v.string()) });
export type PollOption = v.InferOutput<typeof PollOptionSchema>;
export type PollVote = v.InferOutput<typeof PollVoteSchema>;

export const PollWidgetSchema = v.object({
  ...Frame,
  kind: v.literal("poll"),
  /** Several picks each, or one. */
  multi: v.boolean(),
  options: v.array(PollOptionSchema),
  /** By voter key. */
  votes: v.record(v.string(), PollVoteSchema),
  ...Stamp,
});
export type PollWidget = v.InferOutput<typeof PollWidgetSchema>;

// Ideas ---------------------------------------------------------------------

export const IDEAS_MAX = 100;
export const IDEA_TEXT_MAX = 200;
const IdeaText = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(IDEA_TEXT_MAX));

export const IdeaSchema = v.object({
  id: Id,
  text: v.string(),
  by: v.string(),
  hue: Hue,
  at: v.number(),
  /** Voter keys of everyone who upvoted it. */
  votes: v.array(v.string()),
});
export type Idea = v.InferOutput<typeof IdeaSchema>;

export const IdeasWidgetSchema = v.object({
  ...Frame,
  kind: v.literal("ideas"),
  ideas: v.array(IdeaSchema),
  ...Stamp,
});
export type IdeasWidget = v.InferOutput<typeof IdeasWidgetSchema>;

// Asks ----------------------------------------------------------------------

export const ASK_PEOPLE_MAX = 16;
export const ASKS_PER_PERSON_MAX = 50;
export const ASK_TEXT_MAX = 200;
const AskText = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(ASK_TEXT_MAX));
const PersonName = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(NAME_MAX));

export const AskSchema = v.object({
  id: Id,
  text: v.string(),
  by: v.string(),
  hue: Hue,
  at: v.number(),
  done: v.boolean(),
});
export const AskPersonSchema = v.object({ id: Id, name: v.string(), asks: v.array(AskSchema) });
export type Ask = v.InferOutput<typeof AskSchema>;
export type AskPerson = v.InferOutput<typeof AskPersonSchema>;

export const AsksWidgetSchema = v.object({
  ...Frame,
  kind: v.literal("asks"),
  people: v.array(AskPersonSchema),
  ...Stamp,
});
export type AsksWidget = v.InferOutput<typeof AsksWidgetSchema>;

// Free times ----------------------------------------------------------------

/**
 * A free-times grid covers 7 days in everyone's own time zone. It stores
 * half-hour slots in UTC from 14 hours before the first day (UTC midnight)
 * for 9 days, which covers those 7 local days in every time zone.
 */
export const FREE_DAYS = 7;
export const FREE_SLOT_MIN = 30;
export const FREE_LEAD_MIN = 14 * 60;
export const FREE_SLOTS = 9 * 48;
/** One bit per slot, as hex. */
export const FREE_HEX = FREE_SLOTS / 4;
export const FREE_PEOPLE_MAX = 40;
const Slots = v.pipe(v.string(), v.regex(new RegExp(`^[0-9a-f]{${FREE_HEX}}$`)));

export const FreePersonSchema = v.object({ name: v.string(), hue: Hue, slots: v.string() });
export type FreePerson = v.InferOutput<typeof FreePersonSchema>;

export const FreeTimesWidgetSchema = v.object({
  ...Frame,
  kind: v.literal("freetimes"),
  /** First day shown, as whole days since 1970-01-01 (UTC). */
  startDay: v.number(),
  /** By voter key. */
  people: v.record(v.string(), FreePersonSchema),
  ...Stamp,
});
export type FreeTimesWidget = v.InferOutput<typeof FreeTimesWidgetSchema>;

// Calendar ------------------------------------------------------------------

export const CALENDAR_EVENTS_MAX = 200;
export const EVENT_TITLE_MAX = 80;
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DateStr = v.pipe(v.string(), v.regex(DATE_PATTERN));
const EventTitle = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(EVENT_TITLE_MAX));
/** Minutes since 1970 (UTC). */
const EpochMin = Int(0, 2 ** 31);
export const CALENDAR_MODES = ["month", "week", "day"] as const;
export type CalendarMode = (typeof CALENDAR_MODES)[number];

/**
 * All-day events keep a plain date, the same day for everyone. Timed ones
 * keep UTC minutes, shown in each viewer's own time.
 */
export const CalendarEventSchema = v.object({
  id: Id,
  title: v.string(),
  day: v.nullable(v.string()),
  start: v.nullable(v.number()),
  end: v.nullable(v.number()),
  by: v.string(),
  hue: Hue,
});
export type CalendarEvent = v.InferOutput<typeof CalendarEventSchema>;

export const CalendarWidgetSchema = v.object({
  ...Frame,
  kind: v.literal("calendar"),
  /** The view editors share; viewers can look around on their own. */
  view: v.object({ mode: v.picklist(CALENDAR_MODES), anchor: v.string() }),
  events: v.array(CalendarEventSchema),
  ...Stamp,
});
export type CalendarWidget = v.InferOutput<typeof CalendarWidgetSchema>;

/** Every widget kind. */
export type Widget =
  | NoteWidget
  | TodoWidget
  | BudgetWidget
  | TimerWidget
  | PollWidget
  | IdeasWidget
  | AsksWidget
  | FreeTimesWidget
  | CalendarWidget;
export type WidgetKind = Widget["kind"];
export const WIDGET_KINDS = [
  "note",
  "todo",
  "budget",
  "timer",
  "poll",
  "ideas",
  "asks",
  "freetimes",
  "calendar",
] as const satisfies readonly WidgetKind[];

/** Kinds changed through `change` ops and made with just a title. */
export const FRAMED_KINDS = ["timer", "poll", "ideas", "asks", "freetimes", "calendar"] as const;
export type FramedKind = (typeof FRAMED_KINDS)[number];
export type FramedWidget = Extract<Widget, { kind: FramedKind }>;

// ----------------------------------------------------------------------- ops

const Span = Int(1, NOTE_TEXT_MAX);
/** An edit to a note's text: keep n, insert a string, delete n (text.ts). */
export const TextOpSchema = v.pipe(
  v.array(
    v.union([
      Span,
      v.pipe(v.string(), v.minLength(1), v.maxLength(NOTE_TEXT_MAX)),
      v.strictObject({ d: Span }),
    ]),
  ),
  v.minLength(1),
  v.maxLength(200),
) satisfies v.GenericSchema<unknown, TextOp>;

/**
 * One change to one item inside a list widget. Each touches a single
 * item, so two people can tick different items at the same moment without
 * either change undoing the other.
 */
export const TodoChangeSchema = v.variant("do", [
  v.object({ do: v.literal("add"), itemId: Id, text: TodoText }),
  v.object({ do: v.literal("edit"), itemId: Id, text: TodoText }),
  v.object({ do: v.literal("check"), itemId: Id, done: v.boolean() }),
  v.object({ do: v.literal("remove"), itemId: Id }),
  /** Moves the item to position `to` (0 is the top). */
  v.object({ do: v.literal("move"), itemId: Id, to: Int(0, TODO_ITEMS_MAX - 1) }),
  v.object({ do: v.literal("clearDone") }),
]);
export type TodoChange = v.InferOutput<typeof TodoChangeSchema>;

/**
 * A change to a Budget's total. Clicks are sent as changes, never as a new
 * total, so two people clicking at once both count; "set" is its own op.
 */
export const BudgetChangeSchema = v.variant("do", [
  v.object({
    do: v.literal("adjust"),
    by: v.pipe(
      Amount,
      v.check((n) => n !== 0, "A change can't be zero."),
    ),
  }),
  v.object({ do: v.literal("set"), to: Amount }),
]);
export type BudgetChange = v.InferOutput<typeof BudgetChangeSchema>;

/** One change to a Timer, Poll, Ideas, Asks, Free times or Calendar. */
const TimerChangeSchema = v.variant("do", [
  v.object({ kind: v.literal("timer"), do: v.literal("start") }),
  v.object({ kind: v.literal("timer"), do: v.literal("pause") }),
  v.object({ kind: v.literal("timer"), do: v.literal("reset") }),
  /** A new length; stops it. */
  v.object({ kind: v.literal("timer"), do: v.literal("set"), ms: v.pipe(Ms, v.minValue(1000)) }),
  /** More (or less) time, running or not. */
  v.object({ kind: v.literal("timer"), do: v.literal("add"), ms: Int(-TIMER_MAX_MS, TIMER_MAX_MS) }),
]);

const PollChangeSchema = v.variant("do", [
  v.object({ kind: v.literal("poll"), do: v.literal("addOption"), optionId: Id, text: OptionText }),
  v.object({ kind: v.literal("poll"), do: v.literal("editOption"), optionId: Id, text: OptionText }),
  v.object({ kind: v.literal("poll"), do: v.literal("removeOption"), optionId: Id }),
  /** Your picks, replacing any before. Empty takes your vote back. Viewers may. */
  v.object({
    kind: v.literal("poll"),
    do: v.literal("vote"),
    picks: v.pipe(v.array(Id), v.maxLength(POLL_OPTIONS_MAX)),
  }),
  v.object({ kind: v.literal("poll"), do: v.literal("setMulti"), multi: v.boolean() }),
  v.object({ kind: v.literal("poll"), do: v.literal("clearVotes") }),
]);

const IdeasChangeSchema = v.variant("do", [
  v.object({ kind: v.literal("ideas"), do: v.literal("add"), ideaId: Id, text: IdeaText }),
  v.object({ kind: v.literal("ideas"), do: v.literal("edit"), ideaId: Id, text: IdeaText }),
  v.object({ kind: v.literal("ideas"), do: v.literal("remove"), ideaId: Id }),
  /** Viewers may. */
  v.object({ kind: v.literal("ideas"), do: v.literal("upvote"), ideaId: Id, on: v.boolean() }),
]);

const AsksChangeSchema = v.variant("do", [
  v.object({ kind: v.literal("asks"), do: v.literal("addPerson"), personId: Id, name: PersonName }),
  v.object({ kind: v.literal("asks"), do: v.literal("renamePerson"), personId: Id, name: PersonName }),
  v.object({ kind: v.literal("asks"), do: v.literal("removePerson"), personId: Id }),
  v.object({ kind: v.literal("asks"), do: v.literal("addAsk"), personId: Id, askId: Id, text: AskText }),
  v.object({
    kind: v.literal("asks"),
    do: v.literal("checkAsk"),
    personId: Id,
    askId: Id,
    done: v.boolean(),
  }),
  v.object({ kind: v.literal("asks"), do: v.literal("removeAsk"), personId: Id, askId: Id }),
]);

const FreeTimesChangeSchema = v.variant("do", [
  /** Your own row of slots. */
  v.object({ kind: v.literal("freetimes"), do: v.literal("setSlots"), slots: Slots }),
  /** Moves the week; everyone's slots stay on the same times. */
  v.object({ kind: v.literal("freetimes"), do: v.literal("setStart"), day: Int(0, 100_000) }),
]);

const CalendarEventInput = {
  title: EventTitle,
  day: v.nullable(DateStr),
  start: v.nullable(EpochMin),
  end: v.nullable(EpochMin),
};
const CalendarChangeSchema = v.variant("do", [
  v.object({ kind: v.literal("calendar"), do: v.literal("addEvent"), eventId: Id, ...CalendarEventInput }),
  v.object({ kind: v.literal("calendar"), do: v.literal("editEvent"), eventId: Id, ...CalendarEventInput }),
  v.object({ kind: v.literal("calendar"), do: v.literal("removeEvent"), eventId: Id }),
  v.object({
    kind: v.literal("calendar"),
    do: v.literal("setView"),
    mode: v.picklist(CALENDAR_MODES),
    anchor: DateStr,
  }),
]);

export const WidgetChangeSchema = v.variant("kind", [
  TimerChangeSchema,
  PollChangeSchema,
  IdeasChangeSchema,
  AsksChangeSchema,
  FreeTimesChangeSchema,
  CalendarChangeSchema,
]);
export type WidgetChange = v.InferOutput<typeof WidgetChangeSchema>;
export type ChangeOf<K extends FramedKind> = Extract<WidgetChange, { kind: K }>;
/** A change without its `kind`, for code that already knows the kind. */
export type ChangeBody<K extends FramedKind> =
  ChangeOf<K> extends infer C ? (C extends unknown ? Omit<C, "kind"> : never) : never;

const CreateSchema = v.variant("kind", [
  v.object({
    type: v.literal("create"),
    id: Id,
    kind: v.literal("note"),
    rect: RectSchema,
    color: NoteColorSchema,
    size: v.optional(TextSizeSchema, DEFAULT_TEXT_SIZE),
    text: v.optional(v.pipe(v.string(), v.maxLength(NOTE_TEXT_MAX)), ""),
  }),
  v.object({
    type: v.literal("create"),
    id: Id,
    kind: v.literal("todo"),
    rect: RectSchema,
    color: NoteColorSchema,
    title: v.optional(WidgetTitle, ""),
  }),
  v.object({
    type: v.literal("create"),
    id: Id,
    kind: v.literal("budget"),
    rect: RectSchema,
    color: NoteColorSchema,
    title: v.optional(WidgetTitle, ""),
    currency: v.optional(CurrencySchema, DEFAULT_CURRENCY),
  }),
  v.object({
    type: v.literal("create"),
    id: Id,
    kind: v.picklist(FRAMED_KINDS),
    rect: RectSchema,
    color: NoteColorSchema,
    title: v.optional(WidgetTitle, ""),
  }),
]);

export const OpSchema = v.variant("type", [
  CreateSchema,
  v.object({ type: v.literal("move"), id: Id, rect: RectSchema }),
  v.object({
    type: v.literal("patch"),
    id: Id,
    color: v.optional(NoteColorSchema),
    /** Notes only. */
    size: v.optional(TextSizeSchema),
    /** To-do and Budget: the title line. */
    title: v.optional(WidgetTitle),
    /** Budget only. */
    currency: v.optional(CurrencySchema),
  }),
  v.object({ type: v.literal("item"), id: Id, change: TodoChangeSchema }),
  v.object({ type: v.literal("budget"), id: Id, change: BudgetChangeSchema }),
  v.object({ type: v.literal("change"), id: Id, change: WidgetChangeSchema }),
  v.object({ type: v.literal("delete"), id: Id }),
  /** Brings back a widget you deleted in the last `UNDO_MS`, as it was. */
  v.object({ type: v.literal("restore"), id: Id }),
  /**
   * Typing in a note: an edit made against version `base` of its text. The
   * server moves it past anything applied since, so people can type at once.
   * `resend` is set when a reconnecting client sends an edit again that it
   * never heard back about: the server then replays what it missed first.
   */
  v.object({
    type: v.literal("text"),
    id: Id,
    base: v.pipe(v.number(), v.integer(), v.minValue(0)),
    ops: TextOpSchema,
    resend: v.optional(v.boolean()),
  }),
]);
export type Op = v.InferOutput<typeof OpSchema>;
export type OpInput = v.InferInput<typeof OpSchema>;

// ------------------------------------------------------------------ presence

/** What a person is doing, shown in their cursor pill. */
export const ACTIONS = ["moving", "resizing", "typing", "recoloring", "adding a note", "idle"] as const;
export type Action = (typeof ACTIONS)[number];

export const PresenceSchema = v.object({
  /** Pointer in grid units (fractional). Null when it left the box. */
  cursor: v.nullable(v.object({ x: Coord(GRID_COLS), y: Coord(GRID_MAX_ROWS) })),
  action: v.nullable(v.picklist(ACTIONS)),
  /** A widget mid-drag or mid-resize, before it's committed. */
  drag: v.nullable(v.object({ id: Id, ...RectSchema.entries })),
  /** Selection inside the note being typed in. */
  caret: v.nullable(v.object({ id: Id, start: Int(0, NOTE_TEXT_MAX), end: Int(0, NOTE_TEXT_MAX) })),
});
export type Presence = v.InferOutput<typeof PresenceSchema>;

export const EMPTY_PRESENCE: Presence = { cursor: null, action: null, drag: null, caret: null };

export type Peer = {
  /** One per connection, so two tabs are two cursors. */
  sid: string;
  /** Stable per device; used to recognise "you" across tabs. */
  clientId: string;
  name: string;
  hue: number;
  /** "owner" made it (proved with the owner token); viewers can't change anything. */
  role: Role;
  presence: Presence;
};

/** Roles the owner can give people. */
export const ASSIGNABLE_ROLES = ["editor", "viewer"] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];
export type Role = "owner" | AssignableRole;
export const AssignableRoleSchema = v.picklist(ASSIGNABLE_ROLES);

/**
 * Who may delete a widget: the owner deletes anything; editors only the
 * ones they made (matched by voter key). Viewers delete nothing.
 */
export function mayDelete(widget: { creatorKey?: string | undefined }, role: Role, voter: string): boolean {
  if (role === "owner") return true;
  if (role === "viewer") return false;
  return widget.creatorKey !== undefined && widget.creatorKey === voter;
}

/** Who can get in, and what newcomers can do. The password itself is never here. */
export type Access = { mode: "link" | "password"; defaultRole: AssignableRole };
export const DEFAULT_ACCESS: Access = { mode: "link", defaultRole: "editor" };

export const PASSWORD_MIN = 4;
export const PASSWORD_MAX = 64;

// ------------------------------------------------------- client → server

export const ClientMessageSchema = v.variant("t", [
  v.object({
    t: v.literal("hello"),
    v: v.literal(PROTOCOL_VERSION),
    clientId: Id,
    name: NameSchema,
    hue: HueSchema,
    /** Secret from creation; never relayed. Proves you made this bento. */
    ownerToken: v.optional(v.pipe(v.string(), v.maxLength(64))),
    /** Needed when the bento is password protected (owners skip it). */
    password: v.optional(v.pipe(v.string(), v.maxLength(64))),
  }),
  v.object({ t: v.literal("op"), opId: v.pipe(v.string(), v.maxLength(40)), op: OpSchema }),
  v.object({ t: v.literal("presence"), presence: PresenceSchema }),
  v.object({ t: v.literal("rename"), name: NameSchema }),
  /** Your color in this bento (kept apart from everyone else's, like on joining). */
  v.object({ t: v.literal("recolor"), hue: HueSchema }),
  /** Rename the bento itself. Owner only. */
  v.object({ t: v.literal("retitle"), opId: v.pipe(v.string(), v.maxLength(40)), title: TitleSchema }),
  /** Change who can get in and what newcomers can do. Owner only. */
  v.object({
    t: v.literal("access"),
    opId: v.pipe(v.string(), v.maxLength(40)),
    mode: v.optional(v.picklist(["link", "password"])),
    password: v.optional(v.pipe(v.string(), v.minLength(4), v.maxLength(64))),
    defaultRole: v.optional(AssignableRoleSchema),
  }),
  /** Change the bento's settings (cursors, auto-pack). Owner only. */
  v.object({
    t: v.literal("options"),
    opId: v.pipe(v.string(), v.maxLength(40)),
    cursors: v.optional(v.boolean()),
    autoPack: v.optional(v.boolean()),
  }),
  /** Remove every widget from the bento, for everyone. Owner only. */
  v.object({ t: v.literal("clear"), opId: v.pipe(v.string(), v.maxLength(40)) }),
  /**
   * Delete the bento for good, storage and all. Owner only. There's no
   * `applied` reply: everyone's socket is closed with `CLOSE.deleted`.
   */
  v.object({ t: v.literal("delete"), opId: v.pipe(v.string(), v.maxLength(40)) }),
  /** Give someone at the table a role. Owner only. */
  v.object({
    t: v.literal("role"),
    opId: v.pipe(v.string(), v.maxLength(40)),
    sid: Id,
    role: AssignableRoleSchema,
  }),
  v.object({ t: v.literal("ping") }),
]);
export type ClientMessage = v.InferInput<typeof ClientMessageSchema>;

// ------------------------------------------------------- server → client

/** Chosen when a box is made. Enforced by the server, not just the UI. */
export const BoxOptionsSchema = v.object({
  /** Show everyone's cursors. Off: the server stops relaying positions. */
  cursors: v.optional(v.boolean(), true),
  /**
   * Widgets float up to fill gaps, like food settling in a box. Off by
   * default: notes stay in whatever cell you snap them to.
   */
  autoPack: v.optional(v.boolean(), false),
});
export type BoxOptions = v.InferOutput<typeof BoxOptionsSchema>;
export const DEFAULT_BOX_OPTIONS: BoxOptions = { cursors: true, autoPack: false };

export const CreateBoxSchema = v.object({
  title: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(TITLE_MAX)), ""),
  options: v.optional(BoxOptionsSchema, DEFAULT_BOX_OPTIONS),
  /** Start with a few example notes instead of an empty box. */
  starter: v.optional(v.boolean(), false),
  /** Shown as "by [name]" next to the title, in their color. */
  creator: v.optional(v.object({ name: NameSchema, hue: HueSchema })),
});
export type CreateBox = v.InferInput<typeof CreateBoxSchema>;

export type BoxMeta = {
  id: string;
  title: string;
  createdAt: number;
  options: BoxOptions;
  /** Who made it, as they appear at the table. Kept current when they rename. */
  creator?: { name: string; hue: number };
  /** Missing on bentos made before access existed: treat as DEFAULT_ACCESS. */
  access?: Access;
};

/** What `POST /api/boxes` returns: the meta, plus the owner token, shown once. */
export type CreatedBox = BoxMeta & { ownerToken: string };

export type ServerMessage =
  | {
      t: "welcome";
      self: Peer;
      peers: Peer[];
      box: BoxMeta;
      widgets: Widget[];
      /** The server's clock, so timers count down the same everywhere. */
      now: number;
    }
  /** Confirmed changes, from anyone. `opId` is set for the sender's own op. */
  | { t: "applied"; by: string; opId?: string; upsert: Widget[]; remove: string[] }
  | { t: "rejected"; opId: string; code: RejectCode; message: string }
  | { t: "join"; peer: Peer }
  | { t: "leave"; sid: string }
  | { t: "peer"; sid: string; name: string; hue: number; role: Role; opId?: string }
  | { t: "presence"; sid: string; presence: Presence }
  /**
   * A typed edit to a note, now version `v` of its text, already moved past
   * every earlier edit. `opId` is set for everyone, so the typist knows it's
   * theirs even after reconnecting under a new sid.
   */
  | { t: "text"; id: string; v: number; ops: TextOp; by: string; opId: string }
  /** The bento's meta changed (renamed). `opId` is set for the owner's own request. */
  | { t: "meta"; box: BoxMeta; opId?: string }
  | { t: "pong" }
  | { t: "error"; code: ErrorCode; message: string };

export type RejectCode =
  | "not_found"
  | "exists"
  /** Someone's typing in the note you tried to delete. */
  | "busy"
  /** A typed edit too old for the server to catch up (it no longer has what came between). */
  | "stale"
  | "invalid"
  | "limit"
  | "forbidden"
  | "rate_limited";
export type ErrorCode = "bad_message" | "rate_limited" | "not_ready" | "version";

/** WebSocket close codes in the 4000 range (application-defined). */
export const CLOSE = {
  notFound: 4404,
  badHello: 4400,
  tooMany: 4429,
  forbidden: 4403,
  /** Password protected, and the password was missing or wrong. */
  password: 4401,
  /** Someone else in the bento already goes by that name. */
  nameTaken: 4409,
  /** Cloudflare's free daily quota is used up; back after 00:00 UTC. */
  overCapacity: 4503,
  /** The tab's code speaks an older (or newer) protocol: reload to update. */
  outdated: 4426,
  /** The creator deleted the bento. */
  deleted: 4410,
} as const;

export function parseClientMessage(raw: unknown) {
  return v.safeParse(ClientMessageSchema, raw);
}
