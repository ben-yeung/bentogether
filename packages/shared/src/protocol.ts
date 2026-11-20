import * as v from "valibot";
import { GRID_COLS, GRID_MAX_ROWS } from "./grid";

/**
 * Wire protocol between a browser and a box's Durable Object, over one
 * WebSocket. JSON messages, discriminated by `t`. Everything a client sends
 * is validated with these schemas before the server acts on it.
 */
export const PROTOCOL_VERSION = 1;

// ---------------------------------------------------------------- primitives

export const ID_PATTERN = /^[a-z0-9]{8,24}$/;
export const Id = v.pipe(v.string(), v.regex(ID_PATTERN));

export const NOTE_COLORS = ["tamago", "sake", "edamame", "ume", "nori", "shiso"] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];
export const NoteColorSchema = v.picklist(NOTE_COLORS);

export const NOTE_TEXT_MAX = 2000;

/** Text size of a note, shared by everyone so line wraps match. */
export const TEXT_SIZES = ["s", "m", "l", "xl"] as const;
export type TextSize = (typeof TEXT_SIZES)[number];
export const TextSizeSchema = v.picklist(TEXT_SIZES);
export const DEFAULT_TEXT_SIZE: TextSize = "m";

/** `createdBy` of notes the box made itself (starter notes). */
export const SYSTEM_AUTHOR = "benTogether";
export const NAME_MAX = 24;

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
  createdBy: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
});
export type NoteWidget = v.InferOutput<typeof NoteWidgetSchema>;

/** Every compartment kind. Richer widgets join this union. */
export type Widget = NoteWidget;
export type WidgetKind = Widget["kind"];

// ----------------------------------------------------------------------- ops

export const OpSchema = v.variant("type", [
  v.object({
    type: v.literal("create"),
    id: Id,
    kind: v.literal("note"),
    rect: RectSchema,
    color: NoteColorSchema,
    size: v.optional(TextSizeSchema, DEFAULT_TEXT_SIZE),
    text: v.optional(v.pipe(v.string(), v.maxLength(NOTE_TEXT_MAX)), ""),
  }),
  v.object({ type: v.literal("move"), id: Id, rect: RectSchema }),
  v.object({
    type: v.literal("patch"),
    id: Id,
    text: v.optional(v.pipe(v.string(), v.maxLength(NOTE_TEXT_MAX))),
    color: v.optional(NoteColorSchema),
    size: v.optional(TextSizeSchema),
  }),
  v.object({ type: v.literal("delete"), id: Id }),
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
  /** A compartment mid-drag or mid-resize, before it's committed. */
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
  v.object({ t: v.literal("lease"), id: Id, take: v.boolean() }),
  v.object({ t: v.literal("rename"), name: NameSchema }),
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
   * Compartments float up to fill gaps, like food settling in a box. Off by
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

/** sid of the person editing each note's text, if anyone. */
export type Leases = Record<string, string>;

export type ServerMessage =
  | {
      t: "welcome";
      self: Peer;
      peers: Peer[];
      box: BoxMeta;
      widgets: Widget[];
      leases: Leases;
      rev: number;
    }
  /** Confirmed changes, from anyone. `opId` is set for the sender's own op. */
  | { t: "applied"; rev: number; by: string; opId?: string; upsert: Widget[]; remove: string[] }
  | { t: "rejected"; opId: string; code: RejectCode; message: string }
  | { t: "join"; peer: Peer }
  | { t: "leave"; sid: string }
  | { t: "peer"; sid: string; name: string; hue: number; role: Role; opId?: string }
  | { t: "presence"; sid: string; presence: Presence }
  | { t: "lease"; id: string; holder: string | null }
  /** The bento's meta changed (renamed). `opId` is set for the owner's own request. */
  | { t: "meta"; box: BoxMeta; opId?: string }
  | { t: "pong" }
  | { t: "error"; code: ErrorCode; message: string };

export type RejectCode =
  "not_found" | "exists" | "leased" | "invalid" | "limit" | "forbidden" | "rate_limited";
export type ErrorCode = "bad_message" | "rate_limited" | "not_ready" | "version";

/** WebSocket close codes in the 4000 range (application-defined). */
export const CLOSE = {
  notFound: 4404,
  badHello: 4400,
  tooMany: 4429,
  forbidden: 4403,
  /** Password protected, and the password was missing or wrong. */
  password: 4401,
} as const;

export function parseClientMessage(raw: unknown) {
  return v.safeParse(ClientMessageSchema, raw);
}
