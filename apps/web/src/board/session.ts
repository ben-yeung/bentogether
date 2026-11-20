import { action, createMemo, createOptimisticStore, createStore, onCleanup, type Store } from "solid-js";
import {
  CLOSE,
  DEFAULT_ACCESS,
  DEFAULT_BOX_OPTIONS,
  DEFAULT_TEXT_SIZE,
  EMPTY_PRESENCE,
  NOTE_SIZE,
  PROTOCOL_VERSION,
  findSpot,
  randomId,
  settle,
  type Access,
  type AssignableRole,
  type BoxMeta,
  type ClientMessage,
  type Role,
  type NoteColor,
  type Op,
  type Peer,
  type Presence,
  type Rect,
  type ServerMessage,
  type TextSize,
  type Widget,
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
  created: Record<string, Widget>;
  rects: Record<string, Rect>;
  colors: Record<string, NoteColor>;
  sizes: Record<string, TextSize>;
  deleted: Record<string, true>;
  title: string | null;
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
    created: {},
    rects: {},
    colors: {},
    sizes: {},
    deleted: {},
    title: null,
  });
  const [peers, setPeers] = createStore<Record<string, Peer>>({});
  const [leases, setLeases] = createStore<Record<string, string>>({});

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

  function sendOp(op: Op): Promise<void> {
    const opId = randomId(10);
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
        if (msg.opId && msg.by === server.sid) settleOp(msg.opId);
        return;
      }
      case "rejected":
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

  /** Compartment ids in creation order, so the DOM order is stable. */
  const ids = createMemo(
    () => {
      const all = new Set([...Object.keys(server.widgets), ...Object.keys(overlay.created)]);
      return [...all]
        .filter((id) => !overlay.deleted[id])
        .sort((a, b) => (base(a)?.createdAt ?? 0) - (base(b)?.createdAt ?? 0) || (a < b ? -1 : 1));
    },
    { equals: (a, b) => a.length === b.length && a.every((v, i) => v === b[i]) },
  );

  const gravity = () => ({ gravity: server.meta?.options.autoPack ?? false });

  function base(id: string): Widget | undefined {
    return server.widgets[id] ?? overlay.created[id];
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

  const addNote = action(function* (color: NoteColor) {
    const id = randomId(12);
    const spot = findSpot(rects(), NOTE_SIZE.default.w, NOTE_SIZE.default.h);
    const now = Date.now();
    const me = peers[server.sid];
    setOverlay((d) => {
      d.created[id] = {
        id,
        kind: "note",
        ...spot,
        text: "",
        color,
        size: DEFAULT_TEXT_SIZE,
        createdBy: me?.name ?? "you",
        createdAt: now,
        updatedAt: now,
      };
    });
    overlayLayout(settle([...rects(), { id, ...spot }], id, gravity()));
    yield sendOp({ type: "create", id, kind: "note", rect: spot, color, size: DEFAULT_TEXT_SIZE, text: "" });
    return id;
  });

  const moveNote = action(function* (id: string, to: Rect) {
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
    text: (id: string) => base(id)?.text ?? "",
    textSize: (id: string): TextSize => overlay.sizes[id] ?? base(id)?.size ?? DEFAULT_TEXT_SIZE,
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
    addNote,
    moveNote,
    recolor,
    resizeText,
    retitle,
    setAccess,
    setOptions,
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
