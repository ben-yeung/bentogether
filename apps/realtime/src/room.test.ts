import { describe, expect, it } from "vitest";
import { MIN_HUE_GAP, hueDistance, type Op, type ServerMessage } from "@bentogether/shared";
import { Room, type Outgoing } from "./room";

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

describe("ops", () => {
  it("creates a note, stamps the author and broadcasts it with the opId", () => {
    const room = setup();
    const { out, persist } = room.apply("s1", "op1", note("note0001"));
    const applied = msgs(out, "applied")[0]!.msg;
    expect(applied.t === "applied" && applied.opId).toBe("op1");
    expect(room.widgets.get("note0001")?.createdBy).toBe("Mochi");
    expect(persist.now.has("note0001")).toBe(true);
    expect(room.rev).toBe(1);
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

describe("text leases", () => {
  it("only the lease holder can type, and text saves lazily", () => {
    const room = setup();
    room.apply("s1", "a", note("note0001"));
    expect(room.apply("s1", "t0", { type: "patch", id: "note0001", text: "hi" }).out[0]!.msg.t).toBe(
      "rejected",
    );

    room.lease("s1", "note0001", true);
    const { persist } = room.apply("s1", "t1", { type: "patch", id: "note0001", text: "hi" });
    expect(persist.soon.has("note0001")).toBe(true);
    expect(persist.now.size).toBe(0);

    const denied = room.lease("s2", "note0001", true);
    expect(denied).toEqual([
      { target: { to: "one", sid: "s2" }, msg: { t: "lease", id: "note0001", holder: "s1" } },
    ]);
    expect(room.apply("s2", "t2", { type: "patch", id: "note0001", text: "mine" }).out[0]!.msg.t).toBe(
      "rejected",
    );
  });

  it("anyone can change the text size, and it saves right away", () => {
    const room = setup();
    room.apply("s1", "a", note("note0001"));
    expect(room.widgets.get("note0001")!.size).toBe("m");
    const { persist } = room.apply("s2", "z", { type: "patch", id: "note0001", size: "xl" });
    expect(room.widgets.get("note0001")!.size).toBe("xl");
    expect(persist.now.has("note0001")).toBe(true);
  });

  it("anyone can recolor a note someone is typing in", () => {
    const room = setup();
    room.apply("s1", "a", note("note0001"));
    room.lease("s1", "note0001", true);
    const { out } = room.apply("s2", "c", { type: "patch", id: "note0001", color: "ume" });
    expect(out[0]!.msg.t).toBe("applied");
  });

  it("releases leases when the holder leaves", () => {
    const room = setup();
    room.apply("s1", "a", note("note0001"));
    room.lease("s1", "note0001", true);
    const out = room.leave("s1");
    expect(msgs(out, "lease")[0]!.msg).toEqual({ t: "lease", id: "note0001", holder: null });
    expect(room.leases.size).toBe(0);
  });
});

describe("presence", () => {
  it("relays to others and drops a caret in a note you don't hold", () => {
    const room = setup();
    room.apply("s1", "a", note("note0001"));
    const out = room.presence("s2", {
      cursor: { x: 1.5, y: 2.25 },
      action: "typing",
      drag: null,
      caret: { id: "note0001", start: 0, end: 0 },
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

  it("seeds starter notes without overlaps", () => {
    const room = new Room(meta);
    expect(room.seed()).toHaveLength(3);
    expect(room.widgets.size).toBe(3);
  });
});

describe("ownership", () => {
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

  it("viewers can't change notes or take a note to type in", () => {
    const room = table();
    room.apply("own", "a", note("note0001"));
    room.setRole("own", "r", "gst", "viewer");
    expect(room.apply("gst", "b", note("note0002")).out[0]!.msg).toMatchObject({ code: "forbidden" });
    expect(room.lease("gst", "note0001", true)).toEqual([
      { target: { to: "one", sid: "gst" }, msg: { t: "lease", id: "note0001", holder: null } },
    ]);
    expect(room.leases.size).toBe(0);
  });

  it("only the owner sets roles, and a role sticks to the device on rejoin", () => {
    const room = table();
    expect(room.setRole("gst", "r", "own", "viewer")[0]!.msg).toMatchObject({ code: "forbidden" });
    room.setRole("own", "r", "gst", "viewer");
    room.leave("gst");
    room.join("gst2", { clientId: "clientguest1", name: "Nori", hue: 200 });
    expect(room.peers.get("gst2")!.role).toBe("viewer");
  });

  it("making someone a viewer ends their typing", () => {
    const room = table();
    room.apply("own", "a", note("note0001"));
    room.lease("gst", "note0001", true);
    const out = room.setRole("own", "r", "gst", "viewer");
    expect(out.some((o) => o.msg.t === "lease" && o.msg.holder === null)).toBe(true);
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
