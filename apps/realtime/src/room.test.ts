import { describe, expect, it } from "vitest";
import * as v from "valibot";
import {
  EMPTY_PRESENCE as EMPTY,
  MIN_HUE_GAP,
  hueDistance,
  AsksWidgetSchema,
  BudgetWidgetSchema,
  CalendarWidgetSchema,
  FREE_SLOTS,
  FreeTimesWidgetSchema,
  IdeasWidgetSchema,
  NoteWidgetSchema,
  PollWidgetSchema,
  TimerWidgetSchema,
  TodoWidgetSchema,
  WIDGET_KINDS,
  bitsToSlots,
  clampFor,
  slotsToBits,
  type AsksWidget,
  type BudgetWidget,
  type FreeTimesWidget,
  type NoteWidget,
  type PollWidget,
  type WidgetChange,
  type Op,
  type ServerMessage,
  type TodoWidget,
  type TextOp,
} from "@bentogether/shared";
import { Room, TEXT_HISTORY, type Outgoing } from "./room";

const meta = {
  id: "box12345",
  title: "Lunch",
  createdAt: 0,
  options: { cursors: true, autoPack: true },
};
const hello = (name: string, hue = 100) => ({ clientId: `client${name.toLowerCase()}`, name, hue });
const note = (id: string, x = 0, y = 0): Op => ({
  type: "create",
  id,
  kind: "note",
  rect: { x, y, w: 3, h: 3 },
  color: "tamago",
  size: "m",
  text: "",
});

function msgs(out: Outgoing[], t: ServerMessage["t"]) {
  return out.filter((o) => o.msg.t === t);
}

function setup() {
  const room = new Room(meta, [], () => 1000);
  room.join("s1", hello("Mochi"));
  room.join("s2", hello("Nori"));
  return room;
}

describe("joining", () => {
  it("welcomes the newcomer with the box and tells everyone else", () => {
    const room = new Room(meta);
    room.join("s1", hello("Mochi"));
    const out = room.join("s2", hello("Nori"));
    const welcome = out.find((o) => o.msg.t === "welcome")!;
    expect(welcome.target).toEqual({ to: "one", sid: "s2" });
    expect(welcome.msg.t === "welcome" && welcome.msg.peers.map((p) => p.name)).toEqual(["Mochi"]);
    expect(msgs(out, "join")[0]!.target).toEqual({ to: "others", except: "s2" });
  });

  it("gives two people at the table different colors", () => {
    const room = new Room(meta);
    room.join("s1", hello("Mochi", 100));
    room.join("s2", hello("Nori", 102));
    const [a, b] = [...room.peers.values()];
    expect(hueDistance(a!.hue, b!.hue)).toBeGreaterThanOrEqual(MIN_HUE_GAP);
  });
});

describe("unique names", () => {
  it("knows a name someone else here already has, whatever the case", () => {
    const room = setup();
    expect(room.nameTaken("mochi ", "clientnew")).toBe(true);
    expect(room.nameTaken("Tofu", "clientnew")).toBe(false);
  });

  it("doesn't count your own other tabs", () => {
    const room = setup();
    expect(room.nameTaken("Mochi", "clientmochi")).toBe(false);
  });

  it("frees a name once its person leaves", () => {
    const room = setup();
    room.leave("s1");
    expect(room.nameTaken("Mochi", "clientnew")).toBe(false);
  });

  it("keeps your old name when you rename to a taken one, and tells only you", () => {
    const room = setup();
    const out = room.rename("s2", "MOCHI");
    expect(room.peers.get("s2")!.name).toBe("Nori");
    expect(out).toEqual([
      {
        target: { to: "one", sid: "s2" },
        msg: { t: "peer", sid: "s2", name: "Nori", hue: expect.any(Number), role: "editor" },
      },
    ]);
  });
});

describe("ops", () => {
  it("creates a note, stamps the author and broadcasts it with the opId", () => {
    const room = setup();
    const { out, persist } = room.apply("s1", "op1", note("note0001"));
    const applied = msgs(out, "applied")[0]!.msg;
    expect(applied.t === "applied" && applied.opId).toBe("op1");
    expect(room.widgets.get("note0001")?.createdBy).toBe("Mochi");
    expect(persist.now.has("note0001")).toBe(true);
  });

  it("rejects a duplicate id to the sender only", () => {
    const room = setup();
    room.apply("s1", "a", note("note0001"));
    const { out } = room.apply("s2", "b", note("note0001"));
    expect(out).toEqual([
      {
        target: { to: "one", sid: "s2" },
        msg: { t: "rejected", opId: "b", code: "exists", message: expect.any(String) },
      },
    ]);
  });

  it("moving onto another note pushes it and reports both", () => {
    const room = setup();
    room.apply("s1", "a", note("note0001", 0, 0));
    room.apply("s1", "b", note("note0002", 3, 0));
    const { out } = room.apply("s2", "c", { type: "move", id: "note0002", rect: { x: 0, y: 0, w: 3, h: 3 } });
    const applied = msgs(out, "applied")[0]!.msg;
    const ids = applied.t === "applied" ? applied.upsert.map((w) => w.id).sort() : [];
    expect(ids).toEqual(["note0001", "note0002"]);
    expect(room.widgets.get("note0001")!.y).toBe(3);
  });

  it("clamps sizes to note limits", () => {
    const room = setup();
    room.apply("s1", "a", { ...note("note0001"), rect: { x: 11, y: 0, w: 12, h: 1 } } as Op);
    const w = room.widgets.get("note0001")!;
    expect([w.w, w.h, w.x + w.w <= 12]).toEqual([6, 2, true]);
  });

  it("deleting lets the rest settle upward", () => {
    const room = setup();
    room.apply("s1", "a", note("note0001", 0, 0));
    room.apply("s1", "b", note("note0002", 0, 3));
    room.apply("s1", "c", { type: "delete", id: "note0001" });
    expect(room.widgets.get("note0002")!.y).toBe(0);
  });
});

describe("typing in a note", () => {
  const text = (id: string, base: number, ops: TextOp, resend?: boolean): Op => ({
    type: "text",
    id,
    base,
    ops,
    ...(resend ? { resend } : {}),
  });
  const saved = (room: Room) => room.widgets.get("note0001") as NoteWidget;

  it("applies an edit, sends it to everyone as the next version, and saves lazily", () => {
    const room = setup();
    room.apply("s1", "a", note("note0001"));
    const { out, persist } = room.apply("s1", "t1", text("note0001", 0, ["hi"]));
    expect(out).toEqual([
      {
        target: { to: "all" },
        msg: { t: "text", id: "note0001", v: 1, ops: ["hi"], by: "s1", opId: "t1" },
      },
    ]);
    expect(saved(room)).toMatchObject({ text: "hi", tv: 1 });
    expect(persist.soon.has("note0001")).toBe(true);
    expect(persist.now.size).toBe(0);
  });

  it("lets two people type at once, moving the later edit past the earlier", () => {
    const room = setup();
    room.apply("s1", "a", note("note0001"));
    room.apply("s1", "t1", text("note0001", 0, ["hello"]));
    // Both typed against "hello" (version 1).
    room.apply("s1", "t2", text("note0001", 1, [5, "!"]));
    const { out } = room.apply("s2", "t3", text("note0001", 1, ["Oh, "]));
    expect(saved(room)).toMatchObject({ text: "Oh, hello!", tv: 3 });
    expect(out[0]!.msg).toMatchObject({ t: "text", v: 3, ops: ["Oh, "], by: "s2" });

    // Same spot: the edit applied first goes first.
    room.apply("s1", "t4", text("note0001", 3, [10, "A"]));
    room.apply("s2", "t5", text("note0001", 3, [10, "B"]));
    expect(saved(room).text).toBe("Oh, hello!AB");
  });

  it("refuses edits that don't fit: past the end, from the future, too long, or by a viewer", () => {
    const room = setup();
    room.apply("s1", "a", note("note0001"));
    room.apply("s1", "t1", text("note0001", 0, ["abc"]));
    const code = (op: Op, sid = "s1") => {
      const m = room.apply(sid, "x", op).out[0]!.msg;
      return m.t === "rejected" ? m.code : m.t;
    };
    expect(code(text("note0001", 1, [4, "x"]))).toBe("invalid");
    expect(code(text("note0001", 5, ["x"]))).toBe("invalid");
    expect(code(text("note0001", 1, [3, "x".repeat(2000)]))).toBe("limit");
    expect(code(text("gone0001", 0, ["x"]))).toBe("not_found");
    room.apply("s1", "b", {
      type: "create",
      id: "todo0001",
      kind: "todo",
      rect: { x: 5, y: 0, w: 3, h: 3 },
      color: "tamago",
      title: "",
    });
    expect(code(text("todo0001", 0, ["x"]))).toBe("invalid");
    room.peers.get("s2")!.role = "viewer";
    expect(code(text("note0001", 1, ["x"]), "s2")).toBe("forbidden");
    expect(saved(room).text).toBe("abc");
  });

  it("refuses an edit older than the history it would need", () => {
    const room = setup();
    room.apply("s1", "a", note("note0001"));
    for (let i = 0; i <= TEXT_HISTORY; i++) room.apply("s1", `t${i}`, text("note0001", i, ["x"]));
    const m = room.apply("s2", "late", text("note0001", 0, ["y"])).out[0]!.msg;
    expect(m).toMatchObject({ t: "rejected", code: "stale" });
    // One version newer is still covered.
    expect(room.apply("s2", "ok", text("note0001", 1, ["y"])).out[0]!.msg.t).toBe("text");
  });

  it("catches a reconnecting typist up, and doesn't apply their edit twice", () => {
    const room = setup();
    room.apply("s1", "a", note("note0001"));
    room.apply("s1", "t1", text("note0001", 0, ["hi"]));
    room.apply("s2", "t2", text("note0001", 1, [2, " there"]));
    // s1 lost the line before hearing back about t1, and comes back as s3.
    room.join("s3", hello("Mochi"));
    const { out } = room.apply("s3", "t1", text("note0001", 0, ["hi"], true));
    expect(out.map((o) => o.target)).toEqual([
      { to: "one", sid: "s3" },
      { to: "one", sid: "s3" },
    ]);
    expect(out.map((o) => o.msg.t === "text" && o.msg.opId)).toEqual(["t1", "t2"]);
    expect(saved(room)).toMatchObject({ text: "hi there", tv: 2 });

    // An edit that never arrived is applied after the catch-up.
    const next = room.apply("s3", "t3", text("note0001", 0, ["Oh "], true)).out;
    expect(next.map((o) => o.target.to)).toEqual(["one", "one", "all"]);
    // Typed against the empty note, so it goes after what was applied first.
    expect(saved(room).text).toBe("hi thereOh ");
  });

  it("anyone can change the text size, and it saves right away", () => {
    const room = setup();
    room.apply("s1", "a", note("note0001"));
    expect((room.widgets.get("note0001") as NoteWidget).size).toBe("m");
    const { persist } = room.apply("s2", "z", { type: "patch", id: "note0001", size: "xl" });
    expect((room.widgets.get("note0001") as NoteWidget).size).toBe("xl");
    expect(persist.now.has("note0001")).toBe(true);
  });

  it("won't delete a note while someone else's caret is in it", () => {
    const room = setup();
    room.apply("s1", "a", note("note0001"));
    room.presence("s2", { ...EMPTY, caret: { id: "note0001", start: 0, end: 0 } });
    expect(room.apply("s1", "d", { type: "delete", id: "note0001" }).out[0]!.msg).toMatchObject({
      code: "busy",
    });
    // Once they've left the note, it can go; your own caret doesn't stop you.
    room.presence("s2", EMPTY);
    room.presence("s1", { ...EMPTY, caret: { id: "note0001", start: 0, end: 0 } });
    expect(room.apply("s1", "d", { type: "delete", id: "note0001" }).out[0]!.msg.t).toBe("applied");
  });
});

describe("presence", () => {
  it("relays to others, keeping a caret only inside a note", () => {
    const room = setup();
    room.apply("s1", "a", note("note0001"));
    const kept = room.presence("s2", { ...EMPTY, caret: { id: "note0001", start: 0, end: 0 } });
    expect(kept[0]!.msg.t === "presence" && kept[0]!.msg.presence.caret).toEqual({
      id: "note0001",
      start: 0,
      end: 0,
    });
    const out = room.presence("s2", {
      cursor: { x: 1.5, y: 2.25 },
      action: "typing",
      drag: null,
      caret: { id: "gone0001", start: 0, end: 0 },
    });
    expect(out[0]!.target).toEqual({ to: "others", except: "s2" });
    expect(out[0]!.msg.t === "presence" && out[0]!.msg.presence.caret).toBeNull();
  });
});

describe("box options", () => {
  it("never relays cursor positions when cursors are off", () => {
    const room = new Room({ ...meta, options: { cursors: false, autoPack: true } });
    room.join("s1", hello("Mochi"));
    room.join("s2", hello("Nori"));
    const out = room.presence("s1", { cursor: { x: 1, y: 1 }, action: "moving", drag: null, caret: null });
    expect(out[0]!.msg.t === "presence" && out[0]!.msg.presence).toMatchObject({
      cursor: null,
      action: "moving",
    });
  });

  it("leaves gaps when auto-pack is off", () => {
    const room = new Room({ ...meta, options: { cursors: true, autoPack: false } });
    room.join("s1", hello("Mochi"));
    room.apply("s1", "a", note("note0001", 0, 5));
    expect(room.widgets.get("note0001")!.y).toBe(5);
  });

  it("seeds the base template: every kind, valid, inside the grid, without overlaps", () => {
    const room = new Room(meta, [], () => Date.UTC(2026, 10, 20, 9));
    const ids = room.seed();
    const all = [...room.widgets.values()];
    expect(ids).toHaveLength(all.length);
    expect(new Set(all.map((w) => w.kind))).toEqual(new Set(WIDGET_KINDS));
    const schemas = {
      note: NoteWidgetSchema,
      todo: TodoWidgetSchema,
      budget: BudgetWidgetSchema,
      timer: TimerWidgetSchema,
      poll: PollWidgetSchema,
      ideas: IdeasWidgetSchema,
      asks: AsksWidgetSchema,
      freetimes: FreeTimesWidgetSchema,
      calendar: CalendarWidgetSchema,
    };
    for (const w of all) {
      expect(v.safeParse(schemas[w.kind], w).issues).toBeUndefined();
      expect(clampFor(w.kind, w)).toEqual({ x: w.x, y: w.y, w: w.w, h: w.h });
      for (const o of all)
        if (o !== w)
          expect(w.x < o.x + o.w && o.x < w.x + w.w && w.y < o.y + o.h && o.y < w.y + w.h).toBe(false);
    }
  });
});

describe("ownership", () => {
  it("lets an editor delete only the widgets they added; the owner deletes any", () => {
    const room = new Room(meta);
    room.join("own", hello("Mochi"), true);
    room.join("ed1", hello("Nori"));
    room.join("ed2", hello("Yuzu"));
    room.apply("own", "c1", note("ownnote1", 0, 0));
    room.apply("ed1", "c2", note("ed1note1", 3, 0));
    room.apply("ed1", "c3", note("ed1note2", 6, 0));
    // The key is a hash, never the device id itself.
    expect(room.widgets.get("ed1note1")?.creatorKey).toMatch(/^[a-z0-9]+$/);
    expect(room.widgets.get("ed1note1")?.creatorKey).not.toContain("clientnori");

    const notYours = room.apply("ed2", "d1", { type: "delete", id: "ed1note1" });
    expect(notYours.out[0]!.msg).toMatchObject({ t: "rejected", opId: "d1", code: "forbidden" });
    const ownersNote = room.apply("ed1", "d2", { type: "delete", id: "ownnote1" });
    expect(ownersNote.out[0]!.msg).toMatchObject({ t: "rejected", code: "forbidden" });
    expect(room.widgets.has("ed1note1") && room.widgets.has("ownnote1")).toBe(true);

    room.apply("ed1", "d3", { type: "delete", id: "ed1note1" });
    expect(room.widgets.has("ed1note1")).toBe(false);
    room.apply("own", "d4", { type: "delete", id: "ed1note2" });
    expect(room.widgets.has("ed1note2")).toBe(false);
  });

  it("follows the creator across tabs, and leaves older widgets to the owner", () => {
    const room = new Room(meta, [
      {
        id: "oldnote1",
        kind: "note",
        x: 0,
        y: 0,
        w: 3,
        h: 3,
        text: "",
        color: "tamago",
        createdBy: "Nori",
        createdAt: 0,
        updatedAt: 0,
      },
    ]);
    room.join("tab1", hello("Nori"));
    room.join("tab2", hello("Nori"));
    room.apply("tab1", "c1", note("newnote1", 3, 0));
    room.apply("tab2", "d1", { type: "delete", id: "newnote1" });
    expect(room.widgets.has("newnote1")).toBe(false);
    // No creator key (made before keys, or by the box itself): owner only.
    const denied = room.apply("tab1", "d2", { type: "delete", id: "oldnote1" });
    expect(denied.out[0]!.msg).toMatchObject({ t: "rejected", code: "forbidden" });
  });

  it("lets only the owner rename the bento, and tells everyone", () => {
    const room = new Room(meta);
    room.join("own", hello("Mochi"), true);
    room.join("gst", hello("Nori"));

    const denied = room.retitle("gst", "r1", "Hijacked");
    expect(denied[0]!.msg).toMatchObject({ t: "rejected", opId: "r1", code: "forbidden" });
    expect(room.meta.title).toBe("Lunch");

    const ok = room.retitle("own", "r2", "Dinner");
    expect(ok[0]).toEqual({ target: { to: "all" }, msg: { t: "meta", box: room.meta, opId: "r2" } });
    expect(room.meta.title).toBe("Dinner");
  });

  it("lets only the owner clear the bento, which removes every widget for everyone", () => {
    const room = new Room(meta);
    room.join("own", hello("Mochi"), true);
    room.join("gst", hello("Nori"));
    room.apply("own", "c1", note("aaaaaaaa", 0, 0));
    room.apply("own", "c2", note("bbbbbbbb", 3, 0));
    room.presence("gst", { ...EMPTY, caret: { id: "aaaaaaaa", start: 0, end: 0 } });

    const denied = room.clear("gst", "x1");
    expect(denied.out[0]!.msg).toMatchObject({ t: "rejected", opId: "x1", code: "forbidden" });
    expect(room.widgets.size).toBe(2);

    const { out, persist } = room.clear("own", "x2");
    expect(room.widgets.size).toBe(0);
    expect([...persist.removed].sort()).toEqual(["aaaaaaaa", "bbbbbbbb"]);
    expect(msgs(out, "applied")[0]).toMatchObject({
      target: { to: "all" },
      msg: { opId: "x2", upsert: [], remove: ["aaaaaaaa", "bbbbbbbb"] },
    });
  });

  it("lets only the owner delete the bento", () => {
    const room = new Room(meta);
    room.join("own", hello("Mochi"), true);
    room.join("gst", hello("Nori"));
    expect(room.mayDelete("gst", "d1")?.[0]).toMatchObject({
      target: { to: "one", sid: "gst" },
      msg: { t: "rejected", opId: "d1", code: "forbidden" },
    });
    expect(room.mayDelete("own", "d2")).toBeNull();
  });

  it("credits the owner by their current name and color", () => {
    const room = new Room(meta);
    const out = room.join("own", hello("Mochi", 30), true);
    expect(room.meta.creator).toEqual({ name: "Mochi", hue: 30 });
    expect(out.some((o) => o.msg.t === "meta")).toBe(true);

    room.rename("own", "Mochi-san");
    expect(room.meta.creator).toEqual({ name: "Mochi-san", hue: 30 });

    // A guest renaming themselves never touches the credit.
    room.join("gst", hello("Nori", 200));
    room.rename("gst", "Imposter");
    expect(room.meta.creator?.name).toBe("Mochi-san");
  });

  it("marks only the verified connection as owner", () => {
    const room = new Room(meta);
    room.join("own", hello("Mochi"), true);
    room.join("gst", hello("Mochi"));
    expect(room.peers.get("own")!.role).toBe("owner");
    expect(room.peers.get("gst")!.role).toBe("editor");
  });
});

describe("roles and access", () => {
  function table() {
    const room = new Room(meta);
    room.join("own", { clientId: "clientowner1", name: "Mochi", hue: 10 }, true);
    room.join("gst", { clientId: "clientguest1", name: "Nori", hue: 200 });
    return room;
  }

  it("never shows device ids to other people", () => {
    const room = table();
    const out = room.join("new", { clientId: "clientnew001", name: "Yuzu", hue: 90 });
    const welcome = out.find((o) => o.msg.t === "welcome")!.msg;
    expect(welcome.t === "welcome" && welcome.peers.every((p) => p.clientId === "")).toBe(true);
    expect(welcome.t === "welcome" && welcome.self.clientId).toBe("clientnew001");
    const join = out.find((o) => o.msg.t === "join")!.msg;
    expect(join.t === "join" && join.peer.clientId).toBe("");
  });

  it("viewers can't change notes or type in them, and show no caret", () => {
    const room = table();
    room.apply("own", "a", note("note0001"));
    room.setRole("own", "r", "gst", "viewer");
    expect(room.apply("gst", "b", note("note0002")).out[0]!.msg).toMatchObject({ code: "forbidden" });
    expect(
      room.apply("gst", "c", { type: "text", id: "note0001", base: 0, ops: ["x"] }).out[0]!.msg,
    ).toMatchObject({ code: "forbidden" });
    const out = room.presence("gst", { ...EMPTY, caret: { id: "note0001", start: 0, end: 0 } });
    expect(out[0]!.msg.t === "presence" && out[0]!.msg.presence.caret).toBeNull();
  });

  it("only the owner sets roles, and a role sticks to the device on rejoin", () => {
    const room = table();
    expect(room.setRole("gst", "r", "own", "viewer")[0]!.msg).toMatchObject({ code: "forbidden" });
    room.setRole("own", "r", "gst", "viewer");
    room.leave("gst");
    room.join("gst2", { clientId: "clientguest1", name: "Nori", hue: 200 });
    expect(room.peers.get("gst2")!.role).toBe("viewer");
  });

  it("new visitors get the default role; only the owner changes it", () => {
    const room = table();
    expect(room.setAccess("gst", "x", { defaultRole: "viewer" })[0]!.msg).toMatchObject({
      code: "forbidden",
    });
    room.setAccess("own", "x", { defaultRole: "viewer", mode: "password" });
    expect(room.access).toEqual({ mode: "password", defaultRole: "viewer" });
    room.join("late", { clientId: "clientlate01", name: "Ikura", hue: 300 });
    expect(room.peers.get("late")!.role).toBe("viewer");
  });
});

describe("settings", () => {
  it("only the owner changes them; turning cursors off clears positions", () => {
    const room = new Room(meta);
    room.join("own", hello("Mochi"), true);
    room.join("gst", hello("Nori", 200));
    room.presence("gst", { cursor: { x: 1, y: 1 }, action: null, drag: null, caret: null });
    expect(room.setOptions("gst", "o", { autoPack: false })[0]!.msg).toMatchObject({ code: "forbidden" });
    const out = room.setOptions("own", "o", { cursors: false });
    expect(room.meta.options).toEqual({ cursors: false, autoPack: true });
    expect(out.some((o) => o.msg.t === "presence" && o.msg.presence.cursor === null)).toBe(true);
  });
});

describe("to-do lists", () => {
  const todo = (id: string, x = 0, y = 0): Op => ({
    type: "create",
    id,
    kind: "todo",
    rect: { x, y, w: 3, h: 4 },
    color: "edamame",
    title: "",
  });
  const item = (id: string, change: Extract<Op, { type: "item" }>["change"]): Op => ({
    type: "item",
    id,
    change,
  });
  const list = (room: Room, id = "todo0001") => room.widgets.get(id) as TodoWidget;

  it("creates an empty list within the to-do size limits", () => {
    const room = setup();
    room.apply("s1", "a", { ...todo("todo0001"), rect: { x: 0, y: 0, w: 1, h: 1 } } as Op);
    expect(list(room)).toMatchObject({ kind: "todo", w: 2, h: 3, items: [], createdBy: "Mochi" });
  });

  it("saves a title before confirming it, unlike streamed note text", () => {
    const room = setup();
    room.apply("s1", "a", todo("todo0001"));
    const { persist } = room.apply("s1", "b", { type: "patch", id: "todo0001", title: "Groceries" });
    expect(persist.now.has("todo0001")).toBe(true);
    expect(persist.soon.size).toBe(0);
  });

  it("two people change different items without undoing each other", () => {
    const room = setup();
    room.apply("s1", "a", todo("todo0001"));
    room.apply("s1", "b", item("todo0001", { do: "add", itemId: "item0001", text: "Rice" }));
    room.apply("s2", "c", item("todo0001", { do: "add", itemId: "item0002", text: "Nori" }));
    room.apply("s1", "d", item("todo0001", { do: "check", itemId: "item0002", done: true }));
    room.apply("s2", "e", item("todo0001", { do: "edit", itemId: "item0001", text: "Sushi rice" }));
    expect(list(room).items.map((i) => [i.text, i.done, i.by])).toEqual([
      ["Sushi rice", false, "Mochi"],
      ["Nori", true, "Nori"],
    ]);
  });

  it("moves, removes and clears done items", () => {
    const room = setup();
    room.apply("s1", "a", todo("todo0001"));
    for (const [n, text] of ["A", "B", "C"].entries())
      room.apply("s1", `i${n}`, item("todo0001", { do: "add", itemId: `item000${n}`, text }));
    room.apply("s1", "m", item("todo0001", { do: "move", itemId: "item0002", to: 0 }));
    expect(list(room).items.map((i) => i.text)).toEqual(["C", "A", "B"]);
    room.apply("s1", "k", item("todo0001", { do: "check", itemId: "item0000", done: true }));
    room.apply("s1", "c", item("todo0001", { do: "clearDone" }));
    room.apply("s1", "r", item("todo0001", { do: "remove", itemId: "item0002" }));
    expect(list(room).items.map((i) => i.text)).toEqual(["B"]);
  });

  it("rejects changes to missing items, duplicate items and full lists", () => {
    const room = setup();
    room.apply("s1", "a", todo("todo0001"));
    const gone = room.apply("s1", "g", item("todo0001", { do: "check", itemId: "nope0001", done: true }));
    expect(gone.out[0]!.msg).toMatchObject({ t: "rejected", code: "not_found" });
    room.apply("s1", "b", item("todo0001", { do: "add", itemId: "item0001", text: "x" }));
    const dup = room.apply("s1", "c", item("todo0001", { do: "add", itemId: "item0001", text: "y" }));
    expect(dup.out[0]!.msg).toMatchObject({ code: "exists" });
    for (let n = 1; n < 100; n++)
      room.apply(
        "s1",
        `f${n}`,
        item("todo0001", { do: "add", itemId: `fill${String(n).padStart(4, "0")}`, text: "x" }),
      );
    const full = room.apply("s1", "z", item("todo0001", { do: "add", itemId: "item9999", text: "z" }));
    expect(full.out[0]!.msg).toMatchObject({ code: "limit" });
  });

  it("sets titles on lists and notes, and keeps note-only and list-only changes apart", () => {
    const room = setup();
    room.apply("s1", "a", todo("todo0001"));
    room.apply("s1", "n", note("note0001", 6, 0));
    room.apply("s2", "t", { type: "patch", id: "todo0001", title: "  Groceries " });
    expect(list(room).title).toBe("Groceries");
    expect(room.apply("s1", "x", { type: "patch", id: "todo0001", size: "l" }).out[0]!.msg).toMatchObject({
      code: "invalid",
    });
    room.apply("s1", "y", { type: "patch", id: "note0001", title: " Plans " });
    expect(room.widgets.get("note0001")).toMatchObject({ kind: "note", title: "Plans" });
    const noList = room.apply("s1", "z", item("note0001", { do: "clearDone" }));
    expect(noList.out[0]!.msg).toMatchObject({ code: "invalid" });
  });

  it("viewers can't change a list", () => {
    const room = new Room(meta);
    room.join("own", hello("Mochi"), true);
    room.join("gst", hello("Nori", 200));
    room.apply("own", "a", todo("todo0001"));
    room.setRole("own", "r", "gst", "viewer");
    const out = room.apply("gst", "b", item("todo0001", { do: "add", itemId: "item0001", text: "x" }));
    expect(out.out[0]!.msg).toMatchObject({ code: "forbidden" });
  });
});

describe("budgets", () => {
  const budget = (id: string): Op => ({
    type: "create",
    id,
    kind: "budget",
    rect: { x: 0, y: 0, w: 3, h: 3 },
    color: "tamago",
    title: "Trip",
    currency: "USD",
  });
  const change = (id: string, c: Extract<Op, { type: "budget" }>["change"]): Op => ({
    type: "budget",
    id,
    change: c,
  });
  const get = (room: Room, id = "budg0001") => room.widgets.get(id) as BudgetWidget;

  it("starts at zero in the chosen currency", () => {
    const room = setup();
    room.apply("s1", "a", budget("budg0001"));
    expect(get(room)).toMatchObject({ kind: "budget", amount: 0, currency: "USD", title: "Trip", log: [] });
  });

  it("clicks from two people both count, and set replaces what came before", () => {
    const room = setup();
    room.apply("s1", "a", budget("budg0001"));
    room.apply("s1", "b", change("budg0001", { do: "set", to: 50000 }));
    room.apply("s1", "c", change("budg0001", { do: "adjust", by: -2000 }));
    room.apply("s2", "d", change("budg0001", { do: "adjust", by: -500 }));
    expect(get(room).amount).toBe(47500);
    room.apply("s2", "e", change("budg0001", { do: "set", to: 10000 }));
    room.apply("s1", "f", change("budg0001", { do: "adjust", by: 2500 }));
    expect(get(room).amount).toBe(12500);
  });

  it("logs who changed it, newest first, keeping the last ten", () => {
    const room = setup();
    room.apply("s1", "a", budget("budg0001"));
    for (let n = 1; n <= 12; n++)
      room.apply(n % 2 ? "s1" : "s2", `c${n}`, change("budg0001", { do: "adjust", by: n }));
    const log = get(room).log;
    expect(log).toHaveLength(10);
    expect(log[0]).toMatchObject({ do: "adjust", amount: 12, by: "Nori" });
    expect(log[9]).toMatchObject({ amount: 3, by: "Mochi" });
    expect(log[0]!.hue).toBe(room.peers.get("s2")!.hue);
  });

  it("goes below zero but not past the limit", () => {
    const room = setup();
    room.apply("s1", "a", budget("budg0001"));
    room.apply("s1", "b", change("budg0001", { do: "adjust", by: -1500 }));
    expect(get(room).amount).toBe(-1500);
    room.apply("s1", "c", change("budg0001", { do: "set", to: 1_000_000_000_000 }));
    const over = room.apply("s1", "d", change("budg0001", { do: "adjust", by: 1 }));
    expect(over.out[0]!.msg).toMatchObject({ code: "limit" });
  });

  it("changes currency and title; only budgets take budget changes", () => {
    const room = setup();
    room.apply("s1", "a", budget("budg0001"));
    room.apply("s1", "n", note("note0001", 6, 0));
    room.apply("s2", "p", { type: "patch", id: "budg0001", currency: "JPY", title: "Tokyo" });
    expect(get(room)).toMatchObject({ currency: "JPY", title: "Tokyo" });
    expect(
      room.apply("s1", "x", { type: "patch", id: "note0001", currency: "EUR" }).out[0]!.msg,
    ).toMatchObject({
      code: "invalid",
    });
    expect(room.apply("s1", "y", change("note0001", { do: "set", to: 1 })).out[0]!.msg).toMatchObject({
      code: "invalid",
    });
  });

  it("viewers can't change a budget", () => {
    const room = new Room(meta);
    room.join("own", hello("Mochi"), true);
    room.join("gst", hello("Nori", 200));
    room.apply("own", "a", budget("budg0001"));
    room.setRole("own", "r", "gst", "viewer");
    const out = room.apply("gst", "b", change("budg0001", { do: "adjust", by: -100 }));
    expect(out.out[0]!.msg).toMatchObject({ code: "forbidden" });
  });
});

describe("timers, polls, ideas, asks, free times and calendars", () => {
  const create = (id: string, kind: "timer" | "poll" | "ideas" | "asks" | "freetimes" | "calendar"): Op => ({
    type: "create",
    id,
    kind,
    rect: { x: 0, y: 0, w: 6, h: 5 },
    color: "nori",
    title: "",
  });
  const change = (id: string, c: WidgetChange): Op => ({ type: "change", id, change: c });
  const viewerTable = (now = 1000) => {
    const room = new Room(meta, [], () => now);
    room.join("own", { clientId: "clientowner1", name: "Mochi", hue: 10 }, true);
    room.join("gst", { clientId: "clientguest1", name: "Nori", hue: 200 });
    room.setRole("own", "r", "gst", "viewer");
    return room;
  };

  it("sends the server's clock in the welcome", () => {
    const room = new Room(meta, [], () => 4242);
    const welcome = room.join("s1", hello("Mochi")).find((o) => o.msg.t === "welcome")!.msg;
    expect(welcome.t === "welcome" && welcome.now).toBe(4242);
  });

  it("runs a timer off the server's clock", () => {
    let now = 10_000;
    const room = new Room(meta, [], () => now);
    room.join("s1", hello("Mochi"));
    room.apply("s1", "a", create("time0001", "timer"));
    room.apply("s1", "b", change("time0001", { kind: "timer", do: "set", ms: 60_000 }));
    room.apply("s1", "c", change("time0001", { kind: "timer", do: "start" }));
    expect(room.widgets.get("time0001")).toMatchObject({ endsAt: 70_000 });
    now = 30_000;
    room.apply("s1", "d", change("time0001", { kind: "timer", do: "pause" }));
    expect(room.widgets.get("time0001")).toMatchObject({ endsAt: null, left: 40_000 });
  });

  it("lets viewers vote in a poll and upvote ideas, and nothing else", () => {
    const room = viewerTable();
    room.apply("own", "a", create("poll0001", "poll"));
    room.apply(
      "own",
      "b",
      change("poll0001", { kind: "poll", do: "addOption", optionId: "opt00001", text: "Ramen" }),
    );
    const vote = room.apply(
      "gst",
      "c",
      change("poll0001", { kind: "poll", do: "vote", picks: ["opt00001"] }),
    );
    expect(vote.out[0]!.msg.t).toBe("applied");
    const addOption = room.apply(
      "gst",
      "d",
      change("poll0001", { kind: "poll", do: "addOption", optionId: "opt00002", text: "Sushi" }),
    );
    expect(addOption.out[0]!.msg).toMatchObject({ code: "forbidden" });

    room.apply("own", "e", create("idea0001", "ideas"));
    room.apply(
      "own",
      "f",
      change("idea0001", { kind: "ideas", do: "add", ideaId: "idea0101", text: "Picnic" }),
    );
    const up = room.apply(
      "gst",
      "g",
      change("idea0001", { kind: "ideas", do: "upvote", ideaId: "idea0101", on: true }),
    );
    expect(up.out[0]!.msg.t).toBe("applied");
    const edit = room.apply(
      "gst",
      "h",
      change("idea0001", { kind: "ideas", do: "edit", ideaId: "idea0101", text: "Hike" }),
    );
    expect(edit.out[0]!.msg).toMatchObject({ code: "forbidden" });
  });

  it("keeps one vote per person, keyed without their device id", () => {
    const room = viewerTable();
    room.apply("own", "a", create("poll0001", "poll"));
    for (const id of ["opt00001", "opt00002"])
      room.apply("own", id, change("poll0001", { kind: "poll", do: "addOption", optionId: id, text: id }));
    room.apply("gst", "v1", change("poll0001", { kind: "poll", do: "vote", picks: ["opt00001"] }));
    room.apply("gst", "v2", change("poll0001", { kind: "poll", do: "vote", picks: ["opt00002"] }));
    const poll = room.widgets.get("poll0001") as PollWidget;
    const votes = Object.entries(poll.votes);
    expect(votes).toHaveLength(1);
    expect(votes[0]![1]).toMatchObject({ name: "Nori", picks: ["opt00002"] });
    expect(votes[0]![0]).not.toContain("clientguest1");
  });

  it("rejects a change meant for another kind", () => {
    const room = setup();
    room.apply("s1", "a", create("time0001", "timer"));
    const out = room.apply("s1", "b", change("time0001", { kind: "poll", do: "clearVotes" }));
    expect(out.out[0]!.msg).toMatchObject({ code: "invalid" });
  });

  it("asks: people and their asks", () => {
    const room = setup();
    room.apply("s1", "a", create("asks0001", "asks"));
    room.apply(
      "s1",
      "b",
      change("asks0001", { kind: "asks", do: "addPerson", personId: "pers0001", name: "Yuzu" }),
    );
    room.apply(
      "s2",
      "c",
      change("asks0001", {
        kind: "asks",
        do: "addAsk",
        personId: "pers0001",
        askId: "askk0001",
        text: "Bring tea",
      }),
    );
    room.apply(
      "s1",
      "d",
      change("asks0001", {
        kind: "asks",
        do: "checkAsk",
        personId: "pers0001",
        askId: "askk0001",
        done: true,
      }),
    );
    expect((room.widgets.get("asks0001") as AsksWidget).people[0]!.asks[0]).toMatchObject({
      text: "Bring tea",
      by: "Nori",
      done: true,
    });
  });

  it("free times: each person's own row, kept on the same times when the week moves", () => {
    const room = setup();
    room.apply("s1", "a", create("free0001", "freetimes"));
    const start = (room.widgets.get("free0001") as FreeTimesWidget).startDay;
    const bits = Array<boolean>(FREE_SLOTS).fill(false);
    bits[200] = true;
    room.apply(
      "s1",
      "b",
      change("free0001", { kind: "freetimes", do: "setSlots", slots: bitsToSlots(bits) }),
    );
    room.apply("s1", "c", change("free0001", { kind: "freetimes", do: "setStart", day: start + 1 }));
    const after = room.widgets.get("free0001") as FreeTimesWidget;
    const row = Object.values(after.people)[0]!;
    expect(slotsToBits(row.slots).indexOf(true)).toBe(200 - 48);
  });

  it("calendar: events are all day or timed, and the view is shared", () => {
    const room = setup();
    room.apply("s1", "a", create("cale0001", "calendar"));
    const bad = room.apply(
      "s1",
      "b",
      change("cale0001", {
        kind: "calendar",
        do: "addEvent",
        eventId: "evnt0001",
        title: "Lunch",
        day: null,
        start: 10,
        end: null,
      }),
    );
    expect(bad.out[0]!.msg).toMatchObject({ code: "invalid" });
    room.apply(
      "s1",
      "c",
      change("cale0001", {
        kind: "calendar",
        do: "addEvent",
        eventId: "evnt0001",
        title: "Lunch",
        day: null,
        start: 600,
        end: 660,
      }),
    );
    room.apply(
      "s2",
      "d",
      change("cale0001", { kind: "calendar", do: "setView", mode: "week", anchor: "2026-11-20" }),
    );
    expect(room.widgets.get("cale0001")).toMatchObject({
      view: { mode: "week", anchor: "2026-11-20" },
      events: [{ id: "evnt0001", title: "Lunch", start: 600, end: 660, by: "Mochi" }],
    });
  });
});

describe("undoing a delete", () => {
  function clocked() {
    let now = 1000;
    const room = new Room(meta, [], () => now);
    room.join("s1", hello("Mochi"));
    room.join("s2", hello("Nori"));
    return { room, tick: (ms: number) => (now += ms) };
  }

  it("brings the widget back as it was, saved and sent to everyone", () => {
    const { room } = clocked();
    room.apply("s1", "a", { ...note("note0001", 3, 0), text: "Keep me" } as Op);
    room.apply("s1", "b", { type: "delete", id: "note0001" });
    const back = room.apply("s1", "c", { type: "restore", id: "note0001" });
    expect(back.out[0]!.msg).toMatchObject({ t: "applied", opId: "c" });
    expect(back.persist.now.has("note0001")).toBe(true);
    const w = room.widgets.get("note0001") as NoteWidget;
    expect([w.text, w.x, w.y]).toEqual(["Keep me", 3, 0]);
  });

  it("only for whoever deleted it", () => {
    const { room } = clocked();
    room.apply("s1", "a", note("note0001"));
    room.apply("s1", "b", { type: "delete", id: "note0001" });
    expect(room.apply("s2", "c", { type: "restore", id: "note0001" }).out[0]!.msg).toMatchObject({
      t: "rejected",
      code: "forbidden",
    });
  });

  it("only for a short while, and only once", () => {
    const { room, tick } = clocked();
    room.apply("s1", "a", note("note0001"));
    room.apply("s1", "b", note("note0002", 3, 0));
    room.apply("s1", "c", { type: "delete", id: "note0001" });
    room.apply("s1", "d", { type: "delete", id: "note0002" });
    expect(room.apply("s1", "e", { type: "restore", id: "note0002" }).out[0]!.msg.t).toBe("applied");
    expect(room.apply("s1", "f", { type: "restore", id: "note0002" }).out[0]!.msg).toMatchObject({
      code: "not_found",
    });
    tick(16_000);
    expect(room.apply("s1", "g", { type: "restore", id: "note0001" }).out[0]!.msg).toMatchObject({
      t: "rejected",
      code: "not_found",
    });
  });

  it("not after the bento is cleared", () => {
    const room = new Room(meta, [], () => 1000);
    room.join("own", hello("Mochi"), true);
    room.apply("own", "a", note("note0001"));
    room.apply("own", "b", { type: "delete", id: "note0001" });
    room.clear("own", "c");
    expect(room.apply("own", "d", { type: "restore", id: "note0001" }).out[0]!.msg).toMatchObject({
      code: "not_found",
    });
  });
});

describe("changing your color", () => {
  it("tells everyone, kept apart from the others' colors", () => {
    const room = setup();
    const nori = room.peers.get("s2")!.hue;
    const out = room.recolor("s1", nori);
    const mochi = room.peers.get("s1")!.hue;
    expect(hueDistance(mochi, nori)).toBeGreaterThanOrEqual(MIN_HUE_GAP);
    expect(out[0]).toMatchObject({ target: { to: "all" }, msg: { t: "peer", sid: "s1", hue: mochi } });
  });
});
