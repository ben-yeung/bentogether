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
  applyTodoChange,
  applyWidgetChange,
  blankFields,
  voterKey,
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
import { BoxNotFound, OverCapacity, Unreachable } from "../lib/api";
import type { LocalIdentity } from "../lib/identity";

const OP_TIMEOUT_MS = 8000;
/** Give up on the first connection after this long and say why. */
const CONNECT_TIMEOUT_MS = 15_000;
const PRESENCE_MS = 50; // 20 Hz
const TEXT_MS = 80;

/** The bento is password protected and the password was missing or wrong. */
export class PasswordRequired extends Error {
  constructor(public readonly wrong: boolean) {
    super(wrong ? "That password didn't work." : "This bento is password protected.");
    this.name = "PasswordRequired";
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
  rev: number;
  sid: string;
  status: SocketStatus;
  /** Why the server ended a live session, when it says (e.g. out of capacity). */
  notice: string | null;
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
    rev: 0,
    sid: "",
    status: "connecting",
    notice: null,
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
  const [leases, setLeases] = createStore<Record<string, string>>({});

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
  const leaseWaiters = new Map<string, (granted: boolean) => void>();

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
    for (const [id, waiter] of leaseWaiters) {
      leaseWaiters.delete(id);
      waiter(false);
    }
  }

  // --------------------------------------------------------------- inbound

  function onMessage(msg: ServerMessage) {
    switch (msg.t) {
      case "welcome": {
        clockOffset = msg.now - Date.now();
        setServer((d) => {
          d.meta = msg.box;
          d.rev = msg.rev;
          d.sid = msg.self.sid;
          const next = Object.fromEntries(msg.widgets.map((w) => [w.id, w]));
          for (const id of Object.keys(d.widgets)) if (!next[id]) delete d.widgets[id];
          for (const w of msg.widgets) {
            if (d.widgets[w.id]) Object.assign(d.widgets[w.id]!, w);
            else d.widgets[w.id] = w;
          }
        });
        setPeers(() => Object.fromEntries([msg.self, ...msg.peers].map((p) => [p.sid, p])));
        setLeases(() => ({ ...msg.leases }));
        if (!welcomed) {
          welcomed = true;
          clearTimeout(connectTimer);
          resolveReady();
        }
        return;
      }
      case "applied": {
        setServer((d) => {
          d.rev = msg.rev;
          for (const id of msg.remove) delete d.widgets[id];
          for (const w of msg.upsert) {
            if (d.widgets[w.id]) Object.assign(d.widgets[w.id]!, w);
            else d.widgets[w.id] = w;
          }
        });
        if (msg.opId && msg.by === server.sid) {
          dropPending(msg.opId);
          settleOp(msg.opId);
        }
        return;
      }
      case "rejected":
        dropPending(msg.opId);
        settleOp(msg.opId, new OpRejected(msg.message));
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
          if (p) p.presence = msg.presence;
        });
        return;
      case "lease": {
        setLeases((d) => {
          if (msg.holder) d[msg.id] = msg.holder;
          else delete d[msg.id];
        });
        const waiter = leaseWaiters.get(msg.id);
        if (waiter) {
          leaseWaiters.delete(msg.id);
          waiter(msg.holder === server.sid);
        }
        return;
      }
      case "meta":
        setServer((d) => {
          d.meta = msg.box;
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
      if (status !== "open") failAllInflight("Lost the connection. That change wasn't saved.");
      if (status === "reconnecting") {
        setPeers(() => ({}));
        setLeases(() => ({}));
      }
      if (status === "closed" && welcomed && close?.code === CLOSE.overCapacity) {
        setServer((d) => {
          d.notice = new OverCapacity().message;
        });
      }
      if (status === "closed" && !welcomed) {
        clearTimeout(connectTimer);
        rejectReady(
          close?.code === CLOSE.password
            ? new PasswordRequired(close.reason === "wrong")
            : close?.code === CLOSE.tooMany
              ? new Error(close.reason || "This bento is full.")
              : close?.code === CLOSE.overCapacity
                ? new OverCapacity()
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
    const stamp = { createdBy: peers[server.sid]?.name ?? "you", createdAt: now, updatedAt: now };
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

  /** The title line of a To-do or Budget. Last one saved wins. */
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

  // -------------------------------------------------------------- typing

  function takeLease(id: string): Promise<boolean> {
    if (leases[id] === server.sid) return Promise.resolve(true);
    if (!socket.send({ t: "lease", id, take: true })) return Promise.resolve(false);
    return new Promise((resolve) => {
      leaseWaiters.get(id)?.(false);
      leaseWaiters.set(id, resolve);
      setTimeout(() => {
        if (leaseWaiters.get(id) === resolve) {
          leaseWaiters.delete(id);
          resolve(false);
        }
      }, 3000);
    });
  }

  function releaseLease(id: string) {
    flushText(id);
    socket.send({ t: "lease", id, take: false });
  }

  const textTimers = new Map<string, { timer: number; text: string }>();

  /** Streams typed text to everyone, coalesced to one message per 80ms. */
  function typeText(id: string, text: string) {
    const pending = textTimers.get(id);
    if (pending) {
      pending.text = text;
      return;
    }
    socket.send({ t: "op", opId: randomId(8), op: { type: "patch", id, text } });
    const entry = { text, timer: 0 };
    entry.timer = window.setTimeout(() => {
      textTimers.delete(id);
      const latest = entry.text;
      if (latest !== text)
        socket.send({ t: "op", opId: randomId(8), op: { type: "patch", id, text: latest } });
    }, TEXT_MS);
    textTimers.set(id, entry);
  }

  function flushText(id: string) {
    const entry = textTimers.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    textTimers.delete(id);
    socket.send({ t: "op", opId: randomId(8), op: { type: "patch", id, text: entry.text } });
  }

  // ------------------------------------------------------------ presence

  let presence: Presence = EMPTY_PRESENCE;
  let presenceTimer = 0;
  let presenceDirty = false;

  /** Merges into your presence and sends it at most 20 times a second. */
  function setPresence(patch: Partial<Presence>) {
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
    socket.send({ t: "presence", presence });
  }

  function rename(name: string) {
    socket.send({ t: "rename", name });
  }

  function close() {
    clearTimeout(connectTimer);
    clearTimeout(presenceTimer);
    for (const { timer } of textTimers.values()) clearTimeout(timer);
    failAllInflight("Closed.");
    socket.close();
  }

  const api = {
    close,
    // state
    server: server as Store<ServerState>,
    peers: peers as Store<Record<string, Peer>>,
    leases: leases as Store<Record<string, string>>,
    ids,
    rect,
    rects,
    color: (id: string): NoteColor => overlay.colors[id] ?? base(id)?.color ?? "tamago",
    text: (id: string) => {
      const w = base(id);
      return w?.kind === "note" ? w.text : "";
    },
    textSize: (id: string): TextSize => {
      const w = base(id);
      return overlay.sizes[id] ?? (w?.kind === "note" ? w.size : undefined) ?? DEFAULT_TEXT_SIZE;
    },
    kind: (id: string): WidgetKind | undefined => base(id)?.kind,
    listTitle: (id: string) => {
      const w = base(id);
      return pending.titles[id]?.title ?? (w && "title" in w ? w.title : "");
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
    access: (): Access => server.meta?.access ?? DEFAULT_ACCESS,
    // actions
    add,
    addNote: (color: NoteColor) => add("note", color),
    move,
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
    setRole,
    remove,
    // live
    takeLease,
    releaseLease,
    typeText,
    setPresence,
    rename,
  };
  return { session: api, ready };
}
