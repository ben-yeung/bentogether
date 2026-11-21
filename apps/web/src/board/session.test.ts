import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, flush } from "solid-js";
import type { ClientMessage, ServerMessage, Widget } from "@bentogether/shared";
import { openSession, type BoxSession } from "./session";

/** A WebSocket double the test drives by hand. */
class FakeSocket {
  static last: FakeSocket;
  static CONNECTING = 0;
  static OPEN = 1;
  readyState = 0;
  sent: ClientMessage[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  constructor(public url: string) {
    FakeSocket.last = this;
  }
  send(data: string) {
    this.sent.push(JSON.parse(data) as ClientMessage);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  deliver(msg: ServerMessage) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  ops() {
    return this.sent.filter((m): m is Extract<ClientMessage, { t: "op" }> => m.t === "op");
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const identity = { clientId: "clienttest01", name: "Mochi", hue: 30 };
const peer = {
  sid: "me00000001",
  clientId: identity.clientId,
  name: "Mochi",
  hue: 30,
  role: "owner" as const,
};
const presence = { cursor: null, action: null, drag: null, caret: null };

let dispose = () => {};

beforeEach(() => {
  vi.stubGlobal("WebSocket", FakeSocket);
});

afterEach(() => {
  dispose();
  vi.unstubAllGlobals();
});

async function connect(widgets: Widget[] = []): Promise<[BoxSession, FakeSocket]> {
  const ready = createRoot((d) => {
    dispose = d;
    return openSession("box0000001", () => identity);
  });
  const ws = FakeSocket.last;
  ws.open();
  expect(ws.sent[0]).toMatchObject({ t: "hello", name: "Mochi" });
  ws.deliver({
    t: "welcome",
    self: { ...peer, presence },
    peers: [],
    box: {
      id: "box0000001",
      title: "Lunch",
      createdAt: 0,
      options: { cursors: true, autoPack: true },
    },
    widgets,
    rev: 0,
    now: Date.now(),
  });
  return [await ready, ws];
}

describe("optimistic overlay", () => {
  it("shows a new note at once and keeps it when the server confirms", async () => {
    const [s, ws] = await connect();
    const done = s.addNote("ume");
    await tick();
    expect(s.ids()).toHaveLength(1);
    const op = ws.ops()[0]!;
    expect(op.op.type).toBe("create");

    const id = op.op.id;
    const confirmed: Widget = {
      id,
      kind: "note",
      x: 0,
      y: 0,
      w: 3,
      h: 3,
      text: "",
      color: "ume",
      createdBy: "Mochi",
      createdAt: 1,
      updatedAt: 1,
    };
    ws.deliver({ t: "applied", rev: 1, by: peer.sid, opId: op.opId, upsert: [confirmed], remove: [] });
    await done;
    await tick();
    expect(s.ids()).toEqual([id]);
    expect(s.server.widgets[id]?.color).toBe("ume");
  });

  it("rolls the note back when the server rejects it", async () => {
    const [s, ws] = await connect();
    const done = s.addNote("tamago");
    await tick();
    expect(s.ids()).toHaveLength(1);
    ws.deliver({ t: "rejected", opId: ws.ops()[0]!.opId, code: "limit", message: "This bento is full." });
    await expect(done).rejects.toThrow("This bento is full.");
    await tick();
    expect(s.ids()).toHaveLength(0);
  });

  it("keeps other people's changes live while your action is in flight", async () => {
    const [s, ws] = await connect();
    void s.addNote("tamago").catch(() => {});
    await tick();
    const theirs: Widget = {
      id: "theirs000001",
      kind: "note",
      x: 6,
      y: 0,
      w: 3,
      h: 3,
      text: "hi",
      color: "nori",
      createdBy: "Nori",
      createdAt: 0,
      updatedAt: 0,
    };
    ws.deliver({ t: "applied", rev: 1, by: "other00001", upsert: [theirs], remove: [] });
    await tick();
    // Not held behind our pending create: see docs/SOLID-2.md, ledger 1.
    expect(s.ids()).toContain("theirs000001");
    expect(s.text("theirs000001")).toBe("hi");
  });
});

describe("connection", () => {
  it("going online while still connecting replaces the attempt without joining twice", async () => {
    createRoot((d) => {
      dispose = d;
      void openSession("box0000001", () => identity).catch(() => {});
    });
    const first = FakeSocket.last;
    dispatchEvent(new Event("online"));
    const second = FakeSocket.last;
    expect(second).not.toBe(first);
    expect(first.readyState).toBe(3);

    // The old attempt connecting late says nothing.
    first.open();
    expect(first.sent).toHaveLength(0);
    second.open();
    expect(second.sent.filter((m) => m.t === "hello")).toHaveLength(1);
  });
});

describe("presence", () => {
  const presences = (ws: FakeSocket) => ws.sent.filter((m) => m.t === "presence");

  it("doesn't send a presence that didn't change", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const [s, ws] = await connect();
      s.setPresence({ cursor: { x: 1, y: 1 } });
      vi.advanceTimersByTime(60);
      s.setPresence({ cursor: { x: 1, y: 1 } });
      vi.advanceTimersByTime(60);
      expect(presences(ws)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("hides the cursor and stops sending it while the tab is out of focus", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const focus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
    try {
      const [s, ws] = await connect();
      s.setPresence({ cursor: { x: 1, y: 1 } });
      vi.advanceTimersByTime(60);

      focus.mockReturnValue(false);
      dispatchEvent(new Event("blur"));
      vi.advanceTimersByTime(60);
      expect(presences(ws).at(-1)).toMatchObject({ presence: { cursor: null } });

      const before = presences(ws).length;
      s.setPresence({ cursor: { x: 5, y: 5 } });
      vi.advanceTimersByTime(60);
      s.setPresence({ cursor: { x: 6, y: 6 } });
      vi.advanceTimersByTime(60);
      expect(presences(ws)).toHaveLength(before);

      focus.mockReturnValue(true);
      dispatchEvent(new Event("focus"));
      s.setPresence({ cursor: { x: 7, y: 7 } });
      vi.advanceTimersByTime(60);
      expect(presences(ws).at(-1)).toMatchObject({ presence: { cursor: { x: 7, y: 7 } } });
    } finally {
      focus.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe("typing in a note", () => {
  const note = (text = "", tv = 0): Widget => ({
    id: "note000001",
    kind: "note",
    x: 0,
    y: 0,
    w: 3,
    h: 3,
    text,
    tv,
    color: "ume",
    size: "m",
    createdBy: "Mochi",
    createdAt: 1,
    updatedAt: 1,
  });
  const id = "note000001";
  type TextOp = Extract<ClientMessage, { t: "op" }>["op"] & { type: "text" };
  const texts = (ws: FakeSocket) =>
    ws.ops().flatMap((m) => (m.op.type === "text" ? [{ opId: m.opId, ...(m.op as TextOp) }] : []));
  const welcome = (widgets: Widget[]): ServerMessage => ({
    t: "welcome",
    self: { ...peer, sid: "me00000002", presence },
    peers: [],
    box: { id: "box0000001", title: "Lunch", createdAt: 0, options: { cursors: true, autoPack: true } },
    widgets,
    rev: 0,
    now: Date.now(),
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps one edit in flight and sends what you type meanwhile once it's confirmed", async () => {
    const [s, ws] = await connect([note("hi", 4)]);
    s.editText(id, [2, "!"]);
    flush();
    expect(s.text(id)).toBe("hi!");
    vi.advanceTimersByTime(60);
    expect(texts(ws)).toEqual([{ opId: expect.any(String), type: "text", id, base: 4, ops: [2, "!"] }]);

    s.editText(id, [3, "?"]);
    s.editText(id, [4, "!"]);
    vi.advanceTimersByTime(200);
    expect(texts(ws)).toHaveLength(1);

    const first = texts(ws)[0]!;
    ws.deliver({ t: "text", id, v: 5, ops: [2, "!"], by: peer.sid, opId: first.opId });
    vi.advanceTimersByTime(60);
    expect(texts(ws)[1]).toMatchObject({ base: 5, ops: [3, "?!"] });
    flush();
    expect(s.text(id)).toBe("hi!?!");
  });

  it("merges someone else's edit with your unconfirmed typing", async () => {
    const [s, ws] = await connect([note("hello", 1)]);
    const seen: Array<unknown> = [];
    s.watchText(id, (op) => seen.push(op));
    s.editText(id, [5, "!"]);
    vi.advanceTimersByTime(60);
    // Bob put "Oh, " at the start before ours reached the server.
    ws.deliver({ t: "text", id, v: 2, ops: ["Oh, "], by: "bob0000001", opId: "bob1" });
    flush();
    expect(s.text(id)).toBe("Oh, hello!");
    flush();
    expect(seen).toEqual([["Oh, "]]);
    // The server moved ours past Bob's.
    ws.deliver({ t: "text", id, v: 3, ops: [9, "!"], by: peer.sid, opId: texts(ws)[0]!.opId });
    flush();
    expect(s.server.widgets[id]).toMatchObject({ text: "Oh, hello!", tv: 3 });
    flush();
    expect(s.text(id)).toBe("Oh, hello!");
  });

  it("keeps your words when the bento refuses them, and shows the saved text again", async () => {
    const [s, ws] = await connect([note("full", 1)]);
    const seen: Array<unknown> = [];
    s.watchText(id, (op) => seen.push(op));
    s.editText(id, [4, " up"]);
    vi.advanceTimersByTime(60);
    ws.deliver({ t: "rejected", opId: texts(ws)[0]!.opId, code: "limit", message: "This note is full." });
    flush();
    expect(s.text(id)).toBe("full");
    flush();
    expect(s.lostText(id)).toBe("full up");
    flush();
    expect(seen).toEqual([null]);
    s.dismissLost(id);
    flush();
    expect(s.lostText(id)).toBeNull();
  });

  it("moves other people's carets along with the text", async () => {
    const [s, ws] = await connect([note("hello", 1)]);
    ws.deliver({ t: "join", peer: { ...peer, sid: "bob0000001", name: "Bob", presence } });
    ws.deliver({
      t: "presence",
      sid: "bob0000001",
      presence: { ...presence, caret: { id, start: 5, end: 5 } },
    });
    flush();
    expect(s.typists(id).map((p) => p.name)).toEqual(["Bob"]);
    ws.deliver({ t: "text", id, v: 2, ops: ["Oh, "], by: "cat0000001", opId: "cat1" });
    flush();
    expect(s.peers["bob0000001"]!.presence.caret).toMatchObject({ start: 9, end: 9 });
  });

  describe("after losing the connection", () => {
    async function dropAndReturn(ws: FakeSocket) {
      ws.readyState = 3;
      ws.onclose?.({ code: 1006, reason: "" });
      dispatchEvent(new Event("online"));
      const next = FakeSocket.last;
      expect(next).not.toBe(ws);
      next.open();
      return next;
    }

    it("sends unanswered typing again, catches up, and never doubles it", async () => {
      const [s, ws] = await connect([note("hi", 1)]);
      s.editText(id, [2, "!"]);
      vi.advanceTimersByTime(60);
      const lostAck = texts(ws)[0]!;

      const next = await dropAndReturn(ws);
      // Meanwhile ours was applied (v2) and Bob added " yo" (v3).
      next.deliver(welcome([note("hi! yo", 3)]));
      // You keep typing while it catches you up.
      s.editText(id, [3, "?"]);
      expect(texts(next)).toEqual([{ ...lostAck, base: 1, resend: true }]);
      flush();
      expect(s.text(id)).toBe("hi!?");

      // A newer edit from Cat overtakes the catch-up.
      next.deliver({ t: "text", id, v: 4, ops: ["> "], by: "cat0000001", opId: "cat1" });
      next.deliver({ t: "text", id, v: 2, ops: [2, "!"], by: "me00000001", opId: lostAck.opId });
      next.deliver({ t: "text", id, v: 3, ops: [3, " yo"], by: "bob0000001", opId: "bob1" });
      flush();
      expect(s.server.widgets[id]).toMatchObject({ text: "> hi! yo", tv: 4 });
      flush();
      // Bob's " yo" and your "?" went at the same spot; his was applied first.
      expect(s.text(id)).toBe("> hi! yo?");
      vi.advanceTimersByTime(60);
      expect(texts(next).at(-1)).toMatchObject({ base: 4, ops: [8, "?"] });
    });

    it("keeps your words when the bento can't catch you up", async () => {
      const [s, ws] = await connect([note("hi", 1)]);
      s.editText(id, [2, " there"]);
      vi.advanceTimersByTime(60);
      const next = await dropAndReturn(ws);
      next.deliver(welcome([note("all new", 9)]));
      next.deliver({ t: "rejected", opId: texts(next)[0]!.opId, code: "stale", message: "" });
      flush();
      expect(s.text(id)).toBe("all new");
      flush();
      expect(s.server.widgets[id]).toMatchObject({ tv: 9 });
      flush();
      expect(s.lostText(id)).toBe("hi there");
    });

    it("drops typing for a note deleted while you were away", async () => {
      const [s, ws] = await connect([note("hi", 1)]);
      s.editText(id, [2, "!"]);
      vi.advanceTimersByTime(60);
      const next = await dropAndReturn(ws);
      next.deliver(welcome([]));
      expect(texts(next)).toHaveLength(0);
      flush();
      expect(s.text(id)).toBe("");
      flush();
      expect(s.lostText(id)).toBeNull();
    });
  });
});
