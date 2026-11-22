import { action, createMemo, createOptimisticStore, createStore, onCleanup, type Store } from "solid-js";
import {
  CLOSE,
  DEFAULT_ACCESS,
  DEFAULT_BOX_OPTIONS,
  DEFAULT_TEXT_SIZE,
  EMPTY_PRESENCE,
  DEFAULT_CURRENCY,
  PROTOCOL_VERSION,
  WIDGET_SIZE,
  applyBudgetChange,
  applyText,
  applyTodoChange,
  composeText,
  isNoopText,
  transformIndex,
  transformText,
  applyWidgetChange,
  blankFields,
  voterKey,
  mayDelete,
  findSpot,
  randomId,
  settle,
  type Access,
  type AssignableRole,
  type BoxMeta,
  type BudgetChange,
  type BudgetLog,
  type Currency,
  type ClientMessage,
  type Role,
  type NoteColor,
  type Op,
  type Peer,
  type Presence,
  type Rect,
  type ServerMessage,
  type TextOp,
  type TextSize,
  type TodoChange,
  type TodoItem,
  type FramedKind,
  type FramedWidget,
  type Widget,
  type WidgetChange,
  type WidgetKind,
} from "@bentogether/shared";
import { Socket, type SocketStatus } from "../lib/socket";
import { socketUrl } from "../lib/config";
import { BoxNotFound, Outdated, OverCapacity, Unreachable } from "../lib/api";
import { forgetOwnerToken } from "../lib/owner";
import { forgetBox } from "../lib/recent";
import type { LocalIdentity } from "../lib/identity";

const OP_TIMEOUT_MS = 8000;
/** Give up on the first connection after this long and say why. */
const CONNECT_TIMEOUT_MS = 15_000;
const PRESENCE_MS = 50; // 20 Hz
/** Typed edits go out at most this often; keystrokes in between are sent together. */
const TEXT_MS = 50;

type TextMessage = Extract<ServerMessage, { t: "text" }>;

/**
 * Your typing in one note, on its way. One edit is in flight at a time;
 * what you type meanwhile waits in `buffer` and goes when the server
 * answers. Both are moved past everyone else's edits as they arrive (see
 * shared/text.ts), so what you see is always the saved text plus your own
 * unconfirmed typing.
 */
type TextDoc = {
  /** The note's text as the server last confirmed it, and its version. */
  known: { text: string; tv: number };
  /** What you see: `known` with your unconfirmed typing applied. */
  local: string;
  inflight: { opId: string; ops: TextOp } | null;
  buffer: TextOp | null;
  /**
   * After a reconnect: edits that arrived before ones we're still being
   * caught up on, by version. Applied as soon as the gap fills.
   */
  early: Map<number, TextMessage>;
  /** The note's text in the last welcome, in case the server can't catch us up. */
  fresh: { text: string; tv: number } | null;
  sentAt: number;
  timer: number;
};

/** The bento is password protected and the password was missing or wrong. */
export class PasswordRequired extends Error {
  constructor(public readonly wrong: boolean) {
    super(wrong ? "That password didn't work." : "This bento is password protected.");
    this.name = "PasswordRequired";
  }
}

/** Someone in the bento already goes by the name you joined with. */
export class NameTaken extends Error {
  constructor(public readonly taken: string) {
    super(`Someone here is already called ${taken}.`);
    this.name = "NameTaken";
  }
}

export class OpRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpRejected";
  }
}

type ServerState = {
  meta: BoxMeta | null;
  widgets: Record<string, Widget>;
  sid: string;
  status: SocketStatus;
  /** Why the server ended a live session, when it says (e.g. out of capacity). */
  notice: string | null;
  /** The creator deleted the bento while you were in it. */
  deleted: boolean;
};

/**
 * Local guesses layered over the server's truth. Written only inside
 * actions, so every entry reverts on its own when its action settles.
 * See docs/SOLID-2.md, ledger entry 1.
 */
type Overlay = {
  rects: Record<string, Rect>;
  colors: Record<string, NoteColor>;
  sizes: Record<string, TextSize>;
  deleted: Record<string, true>;
  title: string | null;
  currencies: Record<string, Currency>;
};

/**
 * List edits on their way to the server. Kept out of actions on purpose:
 * people tick and add items in quick bursts, and real input arriving while
 * an earlier action is in flight is folded into one hold, which can flash
 * the page's <Loading> fallback (see docs/SOLID-2.md, ledger entry 13). Each
 * entry is removed when the server answers, like typed note text.
 */
type Pending = {
  /** Title lines of list widgets, by widget id. */
  titles: Record<string, { key: string; title: string }>;
  /**
   * Item changes by opId, replayed in order on top of the server's list so
   * what others change meanwhile stays visible.
   */
  changes: Record<string, { wid: string; seq: number; change: TodoChange }>;
  /**
   * Budget changes by opId, replayed the same way. Unlike item changes these
   * aren't safe to apply twice (a −20 counted twice is −40), so each one is
   * dropped in the same tick the server's confirmation lands.
   */
  budget: Record<string, { wid: string; seq: number; change: BudgetChange }>;
  /** Changes to the other kinds (Timer, Poll, ...), dropped the same way. */
  widget: Record<string, { wid: string; seq: number; change: WidgetChange }>;
  /**
   * Widgets you've just added, by opId, until the server confirms
   * them. Not in the overlay: a row drawn from an action's optimistic write
   * is rebuilt when the action settles, which would drop anything you'd
   * started typing into the new widget.
   */
  created: Record<string, Widget>;
};

/**
 * Copies `next` into a store object leaf by leaf, so only the fields that
 * changed notify their readers. Nested objects are merged the same way. A
 * null, an object where there was null, and arrays are set whole: merging
 * an array by position would keep items that were removed.
 */
function mergeInto(target: object, next: object, keep: ReadonlySet<string> = NOTHING) {
  const t = target as Record<string, unknown>;
  for (const [key, value] of Object.entries(next)) {
    const cur = t[key];
    const objects = (x: unknown) => typeof x === "object" && x !== null && !Array.isArray(x);
    if (objects(value) && objects(cur)) mergeInto(cur as object, value as object);
    else if (cur !== value) t[key] = value;
  }
  // `next` is the whole record: what it no longer has is gone (say, someone
  // who cleared their free times), except fields the caller keeps on purpose.
  for (const key of Object.keys(t)) if (!(key in next) && !keep.has(key)) delete t[key];
}

const NOTHING: ReadonlySet<string> = new Set();
/** A note with your typing in flight keeps the text you know (see `merge`). */
const OWN_TEXT: ReadonlySet<string> = new Set(["text", "tv"]);

export type BoxSession = ReturnType<typeof createSession>["session"];

/**
 * Opens a box: connects, waits for the first `welcome`, and resolves with
 * the reactive session. Built to be returned from an async `createMemo`,
 * so `<Loading>` shows the loading line until the box arrives and
 * `<Errored>` shows a missing box. The memo's cleanup closes the socket.
 */
type Hello = LocalIdentity & { ownerToken?: string | undefined; password?: string | undefined };

export function openSession(boxId: string, identity: () => Hello): Promise<BoxSession> {
  const { session, ready } = createSession(boxId, identity);
  onCleanup(() => session.close());
  return ready.then(() => session);
}

function createSession(boxId: string, identity: () => Hello) {
  const [server, setServer] = createStore<ServerState>({
    meta: null,
    widgets: {},
    sid: "",
    status: "connecting",
    notice: null,
    deleted: false,
  });
  const [overlay, setOverlay] = createOptimisticStore<Overlay>({
    rects: {},
    colors: {},
    sizes: {},
    deleted: {},
    title: null,
    currencies: {},
  });
  const [pending, setPending] = createStore<Pending>({
    titles: {},
    changes: {},
    budget: {},
    widget: {},
    created: {},
  });

  /** Drops a confirmed or refused change, in the same batch as the server's answer. */
  function dropPending(opId: string) {
    if (!pending.changes[opId] && !pending.budget[opId] && !pending.widget[opId] && !pending.created[opId])
      return;
    setPending((d) => {
      delete d.changes[opId];
      delete d.budget[opId];
      delete d.widget[opId];
      delete d.created[opId];
    });
  }
  const [peers, setPeers] = createStore<Record<string, Peer>>({});
  /** Each note's text as you see it, while some of your typing is unconfirmed. */
  const [drafts, setDrafts] = createStore<Record<string, string>>({});
  /** Typing the bento refused or couldn't take, by note, kept for you to copy. */
  const [lost, setLost] = createStore<Record<string, string>>({});
  const docs = new Map<string, TextDoc>();
  /**
   * Every other note's confirmed text and version. Typing state lives in
   * plain maps, mirrored into the stores for drawing: store reads lag writes
   * until the batch flushes, and edits chain on each other within one task.
   */
  const texts = new Map<string, { text: string; tv: number }>();

  /** Server clock minus ours, from the welcome; timers count with it. */
  let clockOffset = 0;
  const serverNow = () => Date.now() + clockOffset;

  let resolveReady!: () => void;
  let rejectReady!: (e: Error) => void;
  let welcomed = false;
  const ready = new Promise<void>((res, rej) => {
    resolveReady = res;
    rejectReady = rej;
  });
  // A Worker over its daily request limit can't even send a close code (its
  // error page has no CORS), so the socket just keeps failing. Don't leave
  // the loading screen up forever: stop and explain.
  const connectTimer = window.setTimeout(() => {
    if (welcomed) return;
    rejectReady(new Unreachable());
    socket.close();
  }, CONNECT_TIMEOUT_MS);

  // ---------------------------------------------------------- ops in flight

  const inflight = new Map<string, { resolve: () => void; reject: (e: Error) => void; timer: number }>();

  function sendOp(op: Op, opId = randomId(10)): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!socket.send({ t: "op", opId, op })) {
        reject(new OpRejected("You're offline. That change wasn't saved."));
        return;
      }
      const timer = window.setTimeout(() => {
        inflight.delete(opId);
        reject(new OpRejected("The bento didn't answer in time."));
      }, OP_TIMEOUT_MS);
      inflight.set(opId, { resolve, reject, timer });
    });
  }

  function settleOp(opId: string, error?: Error) {
    const entry = inflight.get(opId);
    if (!entry) return;
    inflight.delete(opId);
    clearTimeout(entry.timer);
    if (error) entry.reject(error);
    else entry.resolve();
  }

  function failAllInflight(reason: string) {
    for (const id of [...inflight.keys()]) settleOp(id, new OpRejected(reason));
  }

  /**
   * Puts a widget from the server into the store. A note you have typing in
   * flight for keeps the text you know: your edits name its version, and
   * the server catches you up on the rest edit by edit.
   */
  function merge(d: ServerState, w: Widget) {
    const cur = d.widgets[w.id];
    if (!cur) {
      d.widgets[w.id] = w;
      return;
    }
    if (w.kind === "note" && docs.has(w.id)) {
      const { text: _text, tv: _tv, ...rest } = w;
      mergeInto(cur, rest, OWN_TEXT);
    } else mergeInto(cur, w);
  }

  function mergeAll(d: ServerState, widgets: Widget[]) {
    for (const w of widgets) {
      if (w.kind === "note" && !docs.has(w.id)) texts.set(w.id, { text: w.text, tv: w.tv ?? 0 });
      merge(d, w);
    }
  }

  // --------------------------------------------------------------- inbound

  function onMessage(msg: ServerMessage) {
    switch (msg.t) {
      case "welcome": {
        clockOffset = msg.now - Date.now();
        // A new connection starts blank on the server, so the next presence goes out even if unchanged.
        sentPresence = JSON.stringify(EMPTY_PRESENCE);
        // Only notes with typing still in flight keep the text they knew.
        for (const [id, doc] of [...docs]) {
          doc.early.clear();
          if (!doc.inflight && !doc.buffer) docs.delete(id);
        }
        texts.clear();
        setServer((d) => {
          if (d.meta) mergeInto(d.meta, msg.box);
          else d.meta = msg.box;
          d.sid = msg.self.sid;
          const next = Object.fromEntries(msg.widgets.map((w) => [w.id, w]));
          for (const id of Object.keys(d.widgets)) if (!next[id]) delete d.widgets[id];
          mergeAll(d, msg.widgets);
        });
        setPeers(() => Object.fromEntries([msg.self, ...msg.peers].map((p) => [p.sid, p])));
        resumeTyping(msg.widgets);
        if (!welcomed) {
          welcomed = true;
          clearTimeout(connectTimer);
          resolveReady();
        }
        return;
      }
      case "applied": {
        setServer((d) => {
          for (const id of msg.remove) delete d.widgets[id];
          mergeAll(d, msg.upsert);
        });
        for (const id of msg.remove) {
          texts.delete(id);
          dropDoc(id);
        }
        if (msg.opId && msg.by === server.sid) {
          dropPending(msg.opId);
          settleOp(msg.opId);
        }
        return;
      }
      case "rejected": {
        dropPending(msg.opId);
        settleOp(msg.opId, new OpRejected(msg.message));
        for (const [id, doc] of docs) if (doc.inflight?.opId === msg.opId) loseTyping(id);
        return;
      }
      case "text":
        onText(msg);
        return;
      case "join":
        setPeers((d) => {
          d[msg.peer.sid] = msg.peer;
        });
        return;
      case "leave":
        setPeers((d) => {
          delete d[msg.sid];
        });
        return;
      case "peer":
        setPeers((d) => {
          const p = d[msg.sid];
          if (p) Object.assign(p, { name: msg.name, hue: msg.hue, role: msg.role });
        });
        if (msg.opId) settleOp(msg.opId);
        return;
      case "presence":
        setPeers((d) => {
          const p = d[msg.sid];
          // Field by field: replacing the whole object would re-run every
          // reader of any part of it, 20 times a second per person.
          if (p) mergeInto(p.presence, msg.presence);
        });
        return;
      case "meta":
        setServer((d) => {
          if (d.meta) mergeInto(d.meta, msg.box);
          else d.meta = msg.box;
        });
        if (msg.opId) settleOp(msg.opId);
        return;
      case "pong":
      case "error":
        return;
    }
  }

  const socket = new Socket({
    url: socketUrl(boxId),
    hello: () => {
      const { ownerToken, password, ...who } = identity();
      return {
        t: "hello",
        v: PROTOCOL_VERSION,
        ...who,
        ...(ownerToken ? { ownerToken } : {}),
        ...(password ? { password } : {}),
      };
    },
    onMessage,
    onStatus: (status, close) => {
      setServer((d) => {
        d.status = status;
      });
      // Deleted: your own delete request succeeded; everyone else is told.
      if (status === "closed" && welcomed && close?.code === CLOSE.deleted) {
        if (deleteOpId) settleOp(deleteOpId);
        forgetBox(boxId);
        forgetOwnerToken(boxId);
        setServer((d) => {
          d.deleted = true;
          if (!deleteOpId) d.notice = "The creator deleted this bento.";
        });
      }
      // Typing isn't failed: it waits, and goes again once the bento's back.
      if (status !== "open") failAllInflight("Lost the connection. That change wasn't saved.");
      // Everyone else is shown again by the next welcome. You stay, so your
      // role (and an open editor) holds while the line is down.
      if (status === "reconnecting") {
        const me = peers[server.sid];
        setPeers(() => (me ? { [me.sid]: me } : {}));
      }
      if (status === "closed" && welcomed && close?.code === CLOSE.overCapacity) {
        setServer((d) => {
          d.notice = new OverCapacity().message;
        });
      }
      if (status === "closed" && welcomed && close?.code === CLOSE.outdated) {
        setServer((d) => {
          d.notice = new Outdated().message;
        });
      }
      // Rare: someone took your name while you were reconnecting.
      if (status === "closed" && welcomed && close?.code === CLOSE.nameTaken) {
        setServer((d) => {
          d.notice = "Someone else here took your name while you were away.\nReload to pick another.";
        });
      }
      if (status === "closed" && !welcomed) {
        clearTimeout(connectTimer);
        rejectReady(
          close?.code === CLOSE.password
            ? new PasswordRequired(close.reason === "wrong")
            : close?.code === CLOSE.nameTaken
              ? new NameTaken(identity().name)
              : close?.code === CLOSE.tooMany
                ? new Error(close.reason || "This bento is full.")
                : close?.code === CLOSE.overCapacity
                  ? new OverCapacity()
                  : close?.code === CLOSE.outdated
                    ? new Outdated()
                    : new BoxNotFound(),
        );
      }
    },
  });

  // ------------------------------------------------------------- reading

  /** Widget ids in creation order, so the DOM order is stable. */
  const ids = createMemo(
    () => {
      const all = new Set([
        ...Object.keys(server.widgets),
        ...Object.values(pending.created).map((w) => w.id),
      ]);
      return [...all]
        .filter((id) => !overlay.deleted[id])
        .sort((a, b) => (base(a)?.createdAt ?? 0) - (base(b)?.createdAt ?? 0) || (a < b ? -1 : 1));
    },
    { equals: (a, b) => a.length === b.length && a.every((v, i) => v === b[i]) },
  );

  const gravity = () => ({ gravity: server.meta?.options.autoPack ?? false });

  function base(id: string): Widget | undefined {
    return server.widgets[id] ?? Object.values(pending.created).find((w) => w.id === id);
  }

  function rect(id: string): Rect | undefined {
    const o = overlay.rects[id];
    if (o) return o;
    const w = base(id);
    return w && { x: w.x, y: w.y, w: w.w, h: w.h };
  }

  function rects(): Array<Rect & { id: string }> {
    return ids().flatMap((id) => {
      const r = rect(id);
      return r ? [{ id, ...r }] : [];
    });
  }

  /** Writes a relayout into the overlay (call inside an action). */
  function overlayLayout(next: Array<Rect & { id: string }>) {
    setOverlay((d) => {
      for (const { id, x, y, w, h } of next) {
        const cur = rect(id);
        if (!cur || cur.x !== x || cur.y !== y || cur.w !== w || cur.h !== h) d.rects[id] = { x, y, w, h };
      }
    });
  }

  // ------------------------------------------------------------- actions
  // Each action: optimistic overlay write → yield the server's answer.
  // Success: the overlay reverts and the confirmed value shows through.
  // Rejection: the action throws and the overlay reverts by itself.

  /**
   * Adds a widget of any kind in the first free spot that fits it. It
   * shows at once (see Pending.created) and resolves with its id once the
   * server confirms it.
   */
  function add(kind: WidgetKind, color: NoteColor): Promise<string> {
    const id = randomId(12);
    const opId = randomId(10);
    const size = WIDGET_SIZE[kind].default;
    const rect = findSpot(rects(), size.w, size.h);
    const now = serverNow();
    const stamp = {
      createdBy: peers[server.sid]?.name ?? "you",
      creatorKey: voter(),
      createdAt: now,
      updatedAt: now,
    };
    const base = { id, ...rect, color, ...stamp };
    setPending((d) => {
      d.created[opId] =
        kind === "note"
          ? { ...base, kind, text: "", size: DEFAULT_TEXT_SIZE }
          : kind === "todo"
            ? { ...base, kind, title: "", items: [] }
            : kind === "budget"
              ? { ...base, kind, title: "", currency: DEFAULT_CURRENCY, amount: 0, log: [] }
              : ({ ...base, title: "", ...blankFields(kind, now) } as Widget);
    });
    return sendOp(
      kind === "note"
        ? { type: "create", id, kind, rect, color, size: DEFAULT_TEXT_SIZE, text: "" }
        : kind === "todo"
          ? { type: "create", id, kind, rect, color, title: "" }
          : kind === "budget"
            ? { type: "create", id, kind, rect, color, title: "", currency: DEFAULT_CURRENCY }
            : { type: "create", id, kind, rect, color, title: "" },
      opId,
    )
      .then(() => id)
      .finally(() => dropPending(opId));
  }

  const move = action(function* (id: string, to: Rect) {
    overlayLayout(settle([...rects().filter((r) => r.id !== id), { id, ...to }], id, gravity()));
    yield sendOp({ type: "move", id, rect: to });
  });

  const recolor = action(function* (id: string, color: NoteColor) {
    setOverlay((d) => {
      d.colors[id] = color;
    });
    yield sendOp({ type: "patch", id, color });
  });

  const resizeText = action(function* (id: string, size: TextSize) {
    setOverlay((d) => {
      d.sizes[id] = size;
    });
    yield sendOp({ type: "patch", id, size });
  });

  /** A widget's title line. Last one saved wins. */
  function setListTitle(id: string, title: string): Promise<void> {
    const key = randomId(10);
    setPending((d) => {
      d.titles[id] = { key, title };
    });
    return sendOp({ type: "patch", id, title }).finally(() =>
      setPending((d) => {
        // Only clear it if a later rename hasn't replaced it.
        if (d.titles[id]?.key === key) delete d.titles[id];
      }),
    );
  }

  let changeSeq = 0;

  /** One change to one item in a list; shows at once, confirmed by the server. */
  function changeItem(id: string, change: TodoChange): Promise<void> {
    const opId = randomId(10);
    const seq = ++changeSeq;
    setPending((d) => {
      d.changes[opId] = { wid: id, seq, change };
    });
    // Usually already dropped with the server's answer; this covers timeouts and going offline.
    return sendOp({ type: "item", id, change }, opId).finally(() => dropPending(opId));
  }

  /** A +/− click, a typed amount, or a new total; shows at once. */
  function changeBudget(id: string, change: BudgetChange): Promise<void> {
    const opId = randomId(10);
    const seq = ++changeSeq;
    setPending((d) => {
      d.budget[opId] = { wid: id, seq, change };
    });
    return sendOp({ type: "budget", id, change }, opId).finally(() => dropPending(opId));
  }

  /** A Budget's total and recent changes, with your changes in flight on top. */
  function budget(id: string): { amount: number; log: BudgetLog[]; currency: Currency } {
    const w = base(id);
    if (w?.kind !== "budget") return { amount: 0, log: [], currency: DEFAULT_CURRENCY };
    const me = peers[server.sid];
    const who = { name: me?.name ?? "you", hue: me?.hue ?? 0 };
    let state: { amount: number; log: readonly BudgetLog[] } = w;
    const mine = Object.values(pending.budget)
      .filter((c) => c.wid === id)
      .sort((a, b) => a.seq - b.seq);
    for (const { change } of mine) {
      const res = applyBudgetChange(state, change, who, Date.now());
      if ("amount" in res) state = res;
    }
    return {
      amount: state.amount,
      log: state.log as BudgetLog[],
      currency: overlay.currencies[id] ?? w.currency,
    };
  }

  /** You, as polls and free-times grids know you. */
  const voter = () => voterKey(identity().clientId, boxId);

  /** One change to a Timer, Poll, Ideas, Asks, Free times or Calendar; shows at once. */
  function change(id: string, c: WidgetChange): Promise<void> {
    const opId = randomId(10);
    const seq = ++changeSeq;
    setPending((d) => {
      d.widget[opId] = { wid: id, seq, change: c };
    });
    return sendOp({ type: "change", id, change: c }, opId).finally(() => dropPending(opId));
  }

  /** A widget of one of those kinds, with your changes in flight on top. */
  function live<K extends FramedKind>(id: string, kind: K): Extract<Widget, { kind: K }> | undefined {
    const w = base(id);
    if (w?.kind !== kind) return undefined;
    const me = peers[server.sid];
    const ctx = { name: me?.name ?? "you", hue: me?.hue ?? 0, voter: voter(), now: serverNow() };
    let cur: Widget = w;
    const mine = Object.values(pending.widget)
      .filter((c) => c.wid === id)
      .sort((a, b) => a.seq - b.seq);
    for (const { change: c } of mine) {
      const res = applyWidgetChange(cur, c, ctx);
      if (!("code" in res)) cur = res as FramedWidget;
    }
    return cur as Extract<Widget, { kind: K }>;
  }

  const setCurrency = action(function* (id: string, currency: Currency) {
    setOverlay((d) => {
      d.currencies[id] = currency;
    });
    yield sendOp({ type: "patch", id, currency });
  });

  /** A list's items: the server's, with your changes in flight applied on top. */
  function items(id: string): TodoItem[] {
    const w = base(id);
    if (w?.kind !== "todo") return [];
    const mine = Object.values(pending.changes)
      .filter((c) => c.wid === id)
      .sort((a, b) => a.seq - b.seq);
    const me = peers[server.sid]?.name ?? "you";
    let list: readonly TodoItem[] = w.items;
    for (const { change } of mine) {
      const res = applyTodoChange(list, change, me, Date.now());
      // Something someone else did made it moot (say, the item's gone): skip it.
      if ("items" in res) list = res.items;
    }
    return list as TodoItem[];
  }

  /** Owner only; the server enforces it and rejects anyone else. */
  const retitle = action(function* (title: string) {
    setOverlay((d) => {
      d.title = title;
    });
    yield request((opId) => ({ t: "retitle", opId, title }));
  });

  /** Owner only: general access and the default role for newcomers. */
  const setAccess = action(function* (patch: {
    mode?: Access["mode"];
    password?: string;
    defaultRole?: AssignableRole;
  }) {
    yield request((opId) => ({ t: "access", opId, ...patch }));
  });

  /** Owner only: the bento's settings, for everyone. */
  const setOptions = action(function* (patch: { cursors?: boolean; autoPack?: boolean }) {
    yield request((opId) => ({ t: "options", opId, ...patch }));
  });

  /** Owner only: what someone at the table can do. */
  const setRole = action(function* (sid: string, role: AssignableRole) {
    yield request((opId) => ({ t: "role", opId, sid, role }));
  });

  /** Owner only: removes every widget, for everyone. Can't be undone. */
  function clearBento(): Promise<void> {
    return request((opId) => ({ t: "clear", opId }));
  }

  /** Sends a request the server answers with `meta`/`peer` (or `rejected`) carrying its opId. */
  /** Set while your delete request is out; the server answers by closing. */
  let deleteOpId: string | null = null;

  /** Deletes the bento for everyone. Resolves once the server has. */
  function deleteBento(): Promise<void> {
    return request((opId) => {
      deleteOpId = opId;
      return { t: "delete", opId };
    }).finally(() => {
      deleteOpId = null;
    });
  }

  function request(build: (opId: string) => ClientMessage): Promise<void> {
    const opId = randomId(10);
    return new Promise<void>((resolve, reject) => {
      if (!socket.send(build(opId))) {
        reject(new OpRejected("You're offline. That change wasn't saved."));
        return;
      }
      const timer = window.setTimeout(() => {
        inflight.delete(opId);
        reject(new OpRejected("The bento didn't answer in time."));
      }, OP_TIMEOUT_MS);
      inflight.set(opId, { resolve, reject, timer });
    });
  }

  const remove = action(function* (id: string) {
    setOverlay((d) => {
      d.deleted[id] = true;
    });
    overlayLayout(
      settle(
        rects().filter((r) => r.id !== id),
        undefined,
        gravity(),
      ),
    );
    yield sendOp({ type: "delete", id });
  });

  /** Brings back a widget you just deleted (the server allows `UNDO_MS`). */
  function restore(id: string): Promise<void> {
    return sendOp({ type: "restore", id });
  }

  // -------------------------------------------------------------- typing

  /** A note's text as the server last confirmed it, and its version. */
  function known(id: string): { text: string; tv: number } | null {
    const k = docs.get(id)?.known ?? texts.get(id);
    if (k) return k;
    // A note you just added, not confirmed yet.
    const w = base(id);
    return w?.kind === "note" ? { text: w.text, tv: w.tv ?? 0 } : null;
  }

  /** The text you see, for drawing: what's saved, plus your typing in flight. */
  function shownText(id: string): string {
    const draft = drafts[id];
    if (draft !== undefined) return draft;
    const w = base(id);
    return w?.kind === "note" ? w.text : "";
  }

  type TextWatcher = (op: TextOp | null, text: string) => void;
  const watchers = new Map<string, Set<TextWatcher>>();

  /**
   * Calls `fn` with each change to a note's text that didn't come from your
   * own typing, as an edit of the text you saw, so an open editor can apply
   * it and keep your caret where it was; `text` is the text after it. A
   * null edit means the text was replaced outright (your typing was
   * refused). Returns the unsubscribe.
   */
  function watchText(id: string, fn: TextWatcher): () => void {
    let set = watchers.get(id);
    if (!set) watchers.set(id, (set = new Set()));
    set.add(fn);
    return () => {
      set.delete(fn);
      if (set.size === 0) watchers.delete(id);
    };
  }

  function notify(id: string, op: TextOp | null, text: string) {
    for (const fn of watchers.get(id) ?? []) fn(op, text);
  }

  function showDraft(id: string, doc: TextDoc) {
    const text = doc.local;
    setDrafts((d) => {
      d[id] = text;
    });
  }

  function writeKnown(id: string, k: { text: string; tv: number }) {
    setServer((d) => {
      const w = d.widgets[id];
      if (w?.kind === "note") Object.assign(w, k);
    });
  }

  /** You typed: `op` is an edit of the text you see. Shows at once. */
  function editText(id: string, op: TextOp) {
    if (isNoopText(op)) return;
    let doc = docs.get(id);
    if (!doc) {
      const k = known(id);
      if (!k) return;
      doc = {
        known: k,
        local: k.text,
        inflight: null,
        buffer: null,
        early: new Map(),
        fresh: null,
        sentAt: 0,
        timer: 0,
      };
      docs.set(id, doc);
      texts.delete(id);
    }
    doc.local = applyText(doc.local, op);
    doc.buffer = doc.buffer ? composeText(doc.buffer, op) : op;
    showDraft(id, doc);
    scheduleText(id, doc);
  }

  function scheduleText(id: string, doc: TextDoc) {
    if (doc.timer || doc.inflight || !doc.buffer) return;
    const wait = Math.max(0, TEXT_MS - (Date.now() - doc.sentAt));
    doc.timer = window.setTimeout(() => {
      doc.timer = 0;
      sendText(id, doc, false);
    }, wait);
  }

  /** Sends the buffer as the next edit, or (`resend`) the one in flight again after a reconnect. */
  function sendText(id: string, doc: TextDoc, resend: boolean) {
    if (doc.inflight && !resend) return;
    if (!doc.inflight) {
      if (!doc.buffer) return;
      doc.inflight = { opId: randomId(10), ops: doc.buffer };
      doc.buffer = null;
    }
    doc.sentAt = Date.now();
    // Offline, it stays in flight and goes again with the next welcome.
    socket.send({
      t: "op",
      opId: doc.inflight.opId,
      op: { type: "text", id, base: doc.known.tv, ops: doc.inflight.ops, ...(resend ? { resend } : {}) },
    });
  }

  /** Typing done and confirmed: what you see is the saved text again. */
  function settleDoc(id: string, doc: TextDoc) {
    if (doc.inflight || doc.buffer || doc.early.size > 0 || docs.get(id) !== doc) return;
    docs.delete(id);
    texts.set(id, doc.known);
    setDrafts((d) => {
      delete d[id];
    });
  }

  /** The note's gone: so is any typing for it. */
  function dropDoc(id: string) {
    const doc = docs.get(id);
    if (!doc) return;
    clearTimeout(doc.timer);
    docs.delete(id);
    setDrafts((d) => {
      delete d[id];
    });
  }

  /**
   * The bento refused your typing (or can't catch you up after a long time
   * away). The note goes back to what's saved, and what you'd typed is kept
   * for you to copy.
   */
  function loseTyping(id: string) {
    const doc = docs.get(id);
    if (!doc) return;
    clearTimeout(doc.timer);
    doc.timer = 0;
    const mine = doc.local;
    doc.known = doc.fresh ?? doc.known;
    doc.local = doc.known.text;
    doc.inflight = doc.buffer = doc.fresh = null;
    writeKnown(id, doc.known);
    showDraft(id, doc);
    if (mine !== doc.known.text)
      setLost((d) => {
        d[id] = mine;
      });
    notify(id, null, doc.known.text);
    // Edits that came in while we waited follow on from the fresh text.
    const early = [...doc.early.values()].sort((a, b) => a.v - b.v);
    doc.early.clear();
    for (const m of early) onText(m);
    settleDoc(id, doc);
  }

  /** After a reconnect: send typing that never got an answer again, and catch up. */
  function resumeTyping(widgets: Widget[]) {
    const fresh = new Map(widgets.flatMap((w) => (w.kind === "note" ? [[w.id, w] as const] : [])));
    for (const [id, doc] of [...docs]) {
      const w = fresh.get(id);
      if (!w) {
        dropDoc(id);
        continue;
      }
      clearTimeout(doc.timer);
      doc.timer = 0;
      doc.fresh = { text: w.text, tv: w.tv ?? 0 };
      sendText(id, doc, true);
    }
  }

  /** A typed edit from anyone, yours included, in the order the server applied them. */
  function onText(msg: TextMessage) {
    const doc = docs.get(msg.id);
    const k = known(msg.id);
    if (!k || msg.v <= k.tv) return;
    if (msg.v > k.tv + 1) {
      doc?.early.set(msg.v, msg);
      return;
    }
    const next = { text: applyText(k.text, msg.ops), tv: msg.v };
    if (doc) doc.known = next;
    else texts.set(msg.id, next);
    writeKnown(msg.id, next);
    if (doc && doc.inflight?.opId === msg.opId) {
      // Ours, confirmed. Send what we typed meanwhile.
      doc.inflight = null;
      doc.fresh = null;
      scheduleText(msg.id, doc);
    } else {
      // Someone else's: move our unconfirmed typing past it, and it past ours.
      let incoming = msg.ops;
      if (doc?.inflight) {
        const mine = doc.inflight.ops;
        doc.inflight.ops = transformText(mine, incoming, "right");
        incoming = transformText(incoming, mine, "left");
      }
      if (doc?.buffer) {
        const mine = doc.buffer;
        doc.buffer = transformText(mine, incoming, "right");
        incoming = transformText(incoming, mine, "left");
      }
      if (doc) {
        doc.local = applyText(doc.local, incoming);
        showDraft(msg.id, doc);
      }
      notify(msg.id, incoming, doc ? doc.local : next.text);
    }
    moveCarets(msg);
    if (!doc) return;
    const following = doc.early.get(msg.v + 1);
    if (following) {
      doc.early.delete(following.v);
      onText(following);
    }
    settleDoc(msg.id, doc);
  }

  /** Other people's carets in the note follow the text an edit moved. */
  function moveCarets(msg: TextMessage) {
    const moved = Object.values(peers).filter(
      (p) => p.sid !== msg.by && p.sid !== server.sid && p.presence.caret?.id === msg.id,
    );
    if (moved.length === 0) return;
    setPeers((d) => {
      for (const { sid } of moved) {
        const c = d[sid]?.presence.caret;
        if (!c) continue;
        c.start = transformIndex(c.start, msg.ops);
        c.end = transformIndex(c.end, msg.ops);
      }
    });
  }

  /** People (not this tab) whose caret is in a note: they're typing there. */
  function typists(id: string): Peer[] {
    return Object.values(peers).filter((p) => p.sid !== server.sid && p.presence.caret?.id === id);
  }

  // ------------------------------------------------------------ presence

  let presence: Presence = EMPTY_PRESENCE;
  let sentPresence = JSON.stringify(EMPTY_PRESENCE);
  let presenceTimer = 0;
  let presenceDirty = false;
  /**
   * True while this tab is hidden or another window has focus. Desktop
   * browsers keep firing pointer moves over a background window; nobody is
   * really pointing at the board then, so the cursor stays hidden and costs
   * nothing to send. The board's own pointerleave hides it the same way.
   */
  let away = false;

  function onAttention() {
    const nowAway = document.visibilityState !== "visible" || !document.hasFocus();
    if (nowAway === away) return;
    away = nowAway;
    if (away) setPresence({ cursor: null });
  }
  addEventListener("blur", onAttention);
  addEventListener("focus", onAttention);
  document.addEventListener("visibilitychange", onAttention);

  /**
   * Merges into your presence and sends it at most 20 times a second.
   * Nothing is sent when nothing changed (the cursor is rounded to grid
   * units, so tiny moves often don't).
   */
  function setPresence(patch: Partial<Presence>) {
    if (away && patch.cursor) patch = { ...patch, cursor: null };
    presence = { ...presence, ...patch };
    presenceDirty = true;
    if (presenceTimer) return;
    flushPresence();
    presenceTimer = window.setTimeout(function tick() {
      presenceTimer = 0;
      if (presenceDirty) {
        flushPresence();
        presenceTimer = window.setTimeout(tick, PRESENCE_MS);
      }
    }, PRESENCE_MS);
  }

  function flushPresence() {
    presenceDirty = false;
    const json = JSON.stringify(presence);
    if (json === sentPresence) return;
    if (socket.send({ t: "presence", presence })) sentPresence = json;
  }

  /** Your color here; the server keeps it apart from everyone else's. */
  function recolorSelf(hue: number) {
    socket.send({ t: "recolor", hue });
  }

  function rename(name: string) {
    socket.send({ t: "rename", name });
  }

  function close() {
    removeEventListener("blur", onAttention);
    removeEventListener("focus", onAttention);
    document.removeEventListener("visibilitychange", onAttention);
    clearTimeout(connectTimer);
    clearTimeout(presenceTimer);
    for (const { timer } of docs.values()) clearTimeout(timer);
    failAllInflight("Closed.");
    socket.close();
  }

  const api = {
    close,
    // state
    server: server as Store<ServerState>,
    peers: peers as Store<Record<string, Peer>>,
    ids,
    rect,
    rects,
    color: (id: string): NoteColor => overlay.colors[id] ?? base(id)?.color ?? "tamago",
    text: shownText,
    /** What you typed that the bento refused, kept for you to copy. */
    lostText: (id: string): string | null => lost[id] ?? null,
    dismissLost: (id: string) =>
      setLost((d) => {
        delete d[id];
      }),
    typists,
    textSize: (id: string): TextSize => {
      const w = base(id);
      return overlay.sizes[id] ?? (w?.kind === "note" ? w.size : undefined) ?? DEFAULT_TEXT_SIZE;
    },
    kind: (id: string): WidgetKind | undefined => base(id)?.kind,
    listTitle: (id: string) => {
      const w = base(id);
      return pending.titles[id]?.title ?? (w && "title" in w ? (w.title ?? "") : "");
    },
    items,
    budget,
    live,
    voter,
    serverNow,
    widget: base,
    isMine: (sid: string) => sid === server.sid,
    options: () => server.meta?.options ?? DEFAULT_BOX_OPTIONS,
    title: () => overlay.title ?? server.meta?.title ?? "Untitled bento",
    creator: () => server.meta?.creator ?? null,
    role: (): Role => peers[server.sid]?.role ?? "viewer",
    isOwner: () => peers[server.sid]?.role === "owner",
    canEdit: () => {
      const r = peers[server.sid]?.role;
      return r === "owner" || r === "editor";
    },
    /** The owner deletes anything; editors only widgets they added. */
    canDelete: (id: string) => {
      const w = base(id);
      return !!w && mayDelete(w, peers[server.sid]?.role ?? "viewer", voter());
    },
    access: (): Access => server.meta?.access ?? DEFAULT_ACCESS,
    // actions
    add,
    addNote: (color: NoteColor) => add("note", color),
    move,
    restore,
    changeItem,
    changeBudget,
    change,
    setCurrency,
    setListTitle,
    recolor,
    resizeText,
    retitle,
    setAccess,
    setOptions,
    clearBento,
    deleteBento,
    setRole,
    remove,
    // live
    editText,
    watchText,
    setPresence,
    rename,
    recolorSelf,
  };
  return { session: api, ready };
}
