import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "solid-js";
import type { ClientMessage, ServerMessage, Widget } from "@bentogether/shared";
import { openSession, type BoxSession } from "./session";

/** A WebSocket double the test drives by hand. */
class FakeSocket {
  static last: FakeSocket;
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
  close() {}
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
    leases: {},
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
