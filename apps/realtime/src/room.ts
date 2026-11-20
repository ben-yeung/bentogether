import {
  EMPTY_PRESENCE,
  NOTE_SIZE,
  SYSTEM_AUTHOR,
  clampRect,
  settle,
  separateHue,
  changedIds,
  DEFAULT_ACCESS,
  type Access,
  type AssignableRole,
  type BoxMeta,
  type Leases,
  type Op,
  type Peer,
  type Presence,
  type RejectCode,
  type Role,
  type ServerMessage,
  type Widget,
} from "@bentogether/shared";

export const MAX_WIDGETS = 300;
export const MAX_PEERS = 32;

/** Where an outgoing message goes. */
export type Target = { to: "all" } | { to: "others"; except: string } | { to: "one"; sid: string };
export type Outgoing = { target: Target; msg: ServerMessage };

export type Hello = { clientId: string; name: string; hue: number };

/** What the room asks its host to save after handling a message. */
export type Persist = {
  /** Structural change (create, move, delete, color): save now. */
  now: Set<string>;
  /** Text typed into a note: save soon, coalesced. */
  soon: Set<string>;
  removed: Set<string>;
};

/**
 * All of a box's rules in one pure class: no I/O, no clock, no Workers
 * APIs. The Durable Object feeds it messages and carries out what it
 * returns. That keeps the authoritative logic unit-testable in plain Node.
 */
export class Room {
  readonly widgets = new Map<string, Widget>();
  readonly peers = new Map<string, Peer>();
  readonly leases = new Map<string, string>();
  /** Roles the owner gave, by device (clientId). Persisted by the host. */
  readonly roles = new Map<string, AssignableRole>();
  rev = 0;

  constructor(
    public meta: BoxMeta,
    widgets: Iterable<Widget> = [],
    private now: () => number = Date.now,
    roles: Iterable<[string, AssignableRole]> = [],
  ) {
    for (const w of widgets) this.widgets.set(w.id, w);
    for (const [clientId, role] of roles) this.roles.set(clientId, role);
  }

  get access(): Access {
    return this.meta.access ?? DEFAULT_ACCESS;
  }

  /**
   * How a peer looks to everyone else: device ids stay private, so nobody
   * can borrow someone's id to inherit their role.
   */
  private public(peer: Peer): Peer {
    return { ...peer, clientId: "" };
  }

  // ------------------------------------------------------------- people

  /**
   * `owner` is decided by the host (it checks the owner token), never by
   * anything the client claims. The owner's current name and color become
   * the bento's "by [name]" credit.
   */
  join(sid: string, hello: Hello, owner = false): Outgoing[] {
    const taken = [...this.peers.values()].map((p) => p.hue);
    const role: Role = owner ? "owner" : (this.roles.get(hello.clientId) ?? this.access.defaultRole);
    const peer: Peer = {
      sid,
      clientId: hello.clientId,
      name: hello.name,
      hue: separateHue(hello.hue, taken),
      role,
      presence: EMPTY_PRESENCE,
    };
    const others = [...this.peers.values()];
    this.peers.set(sid, peer);
    const credit = owner ? this.credit(peer) : [];
    return [
      {
        target: { to: "one", sid },
        msg: {
          t: "welcome",
          self: peer,
          peers: others.map((p) => this.public(p)),
          box: this.meta,
          widgets: [...this.widgets.values()],
          leases: this.leaseRecord(),
          rev: this.rev,
        },
      },
      { target: { to: "others", except: sid }, msg: { t: "join", peer: this.public(peer) } },
      ...credit,
    ];
  }

  /** Restores a peer after the Durable Object wakes from hibernation. */
  restore(peer: Peer) {
    this.peers.set(peer.sid, { ...peer, presence: EMPTY_PRESENCE });
  }

  leave(sid: string): Outgoing[] {
    if (!this.peers.delete(sid)) return [];
    const out: Outgoing[] = [{ target: { to: "all" }, msg: { t: "leave", sid } }];
    for (const [id, holder] of this.leases) {
      if (holder === sid) {
        this.leases.delete(id);
        out.push({ target: { to: "all" }, msg: { t: "lease", id, holder: null } });
      }
    }
    return out;
  }

  rename(sid: string, name: string): Outgoing[] {
    const peer = this.peers.get(sid);
    if (!peer) return [];
    peer.name = name;
    return [
      { target: { to: "all" }, msg: { t: "peer", sid, name, hue: peer.hue, role: peer.role } },
      ...(peer.role === "owner" ? this.credit(peer) : []),
    ];
  }

  private ownerOnly(sid: string, opId: string, what: string): Outgoing[] | null {
    if (this.peers.get(sid)?.role === "owner") return null;
    return [
      {
        target: { to: "one", sid },
        msg: { t: "rejected", opId, code: "forbidden", message: `Only the bento's creator can ${what}.` },
      },
    ];
  }

  /** Renames the bento. Only its owner may; everyone sees it at once. */
  retitle(sid: string, opId: string, title: string): Outgoing[] {
    const denied = this.ownerOnly(sid, opId, "rename it");
    if (denied) return denied;
    this.meta = { ...this.meta, title };
    return [{ target: { to: "all" }, msg: { t: "meta", box: this.meta, opId } }];
  }

  /**
   * Changes general access. The password itself is the host's business (it
   * hashes and stores it); the room only records the mode. Owner only.
   */
  setAccess(
    sid: string,
    opId: string,
    patch: { mode?: Access["mode"]; defaultRole?: AssignableRole },
  ): Outgoing[] {
    const denied = this.ownerOnly(sid, opId, "change access");
    if (denied) return denied;
    this.meta = {
      ...this.meta,
      access: {
        mode: patch.mode ?? this.access.mode,
        defaultRole: patch.defaultRole ?? this.access.defaultRole,
      },
    };
    return [{ target: { to: "all" }, msg: { t: "meta", box: this.meta, opId } }];
  }

  /** Changes the bento's settings for everyone. Owner only. */
  setOptions(sid: string, opId: string, patch: { cursors?: boolean; autoPack?: boolean }): Outgoing[] {
    const denied = this.ownerOnly(sid, opId, "change settings");
    if (denied) return denied;
    this.meta = {
      ...this.meta,
      options: {
        cursors: patch.cursors ?? this.meta.options.cursors,
        autoPack: patch.autoPack ?? this.meta.options.autoPack,
      },
    };
    const out: Outgoing[] = [{ target: { to: "all" }, msg: { t: "meta", box: this.meta, opId } }];
    if (patch.cursors === false) {
      // Turning cursors off clears everyone's last position at once.
      for (const p of this.peers.values()) {
        if (!p.presence.cursor) continue;
        p.presence = { ...p.presence, cursor: null };
        out.push({
          target: { to: "others", except: p.sid },
          msg: { t: "presence", sid: p.sid, presence: p.presence },
        });
      }
    }
    return out;
  }

  /**
   * Gives someone at the table a role, remembered for their device. Making
   * someone a viewer also ends any typing they were doing. Owner only.
   */
  setRole(sid: string, opId: string, targetSid: string, role: AssignableRole): Outgoing[] {
    const denied = this.ownerOnly(sid, opId, "change permissions");
    if (denied) return denied;
    const target = this.peers.get(targetSid);
    if (!target || target.role === "owner") {
      return [
        {
          target: { to: "one", sid },
          msg: { t: "rejected", opId, code: "invalid", message: "That person isn't in this bento." },
        },
      ];
    }
    this.roles.set(target.clientId, role);
    // Every connection from that device gets the role, not just this tab.
    const out: Outgoing[] = [];
    for (const p of this.peers.values()) {
      if (p.clientId !== target.clientId) continue;
      p.role = role;
      out.push({
        target: { to: "all" },
        msg: {
          t: "peer",
          sid: p.sid,
          name: p.name,
          hue: p.hue,
          role,
          ...(p.sid === targetSid ? { opId } : {}),
        },
      });
      if (role === "viewer") {
        for (const [id, holder] of this.leases) {
          if (holder !== p.sid) continue;
          this.leases.delete(id);
          out.push({ target: { to: "all" }, msg: { t: "lease", id, holder: null } });
        }
      }
    }
    return out;
  }

  /** Keeps the "by [name]" credit in step with the owner's name and color. */
  private credit(owner: Peer): Outgoing[] {
    const c = this.meta.creator;
    if (c && c.name === owner.name && c.hue === owner.hue) return [];
    this.meta = { ...this.meta, creator: { name: owner.name, hue: owner.hue } };
    return [{ target: { to: "all" }, msg: { t: "meta", box: this.meta } }];
  }

  presence(sid: string, presence: Presence): Outgoing[] {
    const peer = this.peers.get(sid);
    if (!peer) return [];
    // A caret only counts inside a note you hold; a drag only on a real note.
    const caret = presence.caret && this.leases.get(presence.caret.id) === sid ? presence.caret : null;
    const drag = presence.drag && this.widgets.has(presence.drag.id) ? presence.drag : null;
    // Cursors off is a box rule, not a client preference: positions never leave the server.
    const cursor = this.meta.options.cursors ? presence.cursor : null;
    peer.presence = { ...presence, cursor, caret, drag };
    return [{ target: { to: "others", except: sid }, msg: { t: "presence", sid, presence: peer.presence } }];
  }

  // ------------------------------------------------------------- leases

  /** One person types in a note at a time; everyone else watches live. */
  lease(sid: string, id: string, take: boolean): Outgoing[] {
    const holder = this.leases.get(id);
    if (take) {
      if (!this.widgets.has(id)) return [];
      // Viewers watch; the answer "nobody holds it, and not you" ends their wait.
      if (this.peers.get(sid)?.role === "viewer") {
        return [{ target: { to: "one", sid }, msg: { t: "lease", id, holder: holder ?? null } }];
      }
      if (holder && holder !== sid) {
        return [{ target: { to: "one", sid }, msg: { t: "lease", id, holder } }];
      }
      if (holder === sid) return [];
      this.leases.set(id, sid);
      return [{ target: { to: "all" }, msg: { t: "lease", id, holder: sid } }];
    }
    if (holder !== sid) return [];
    this.leases.delete(id);
    return [{ target: { to: "all" }, msg: { t: "lease", id, holder: null } }];
  }

  // ---------------------------------------------------------------- ops

  apply(sid: string, opId: string, op: Op): { out: Outgoing[]; persist: Persist } {
    const persist: Persist = { now: new Set(), soon: new Set(), removed: new Set() };
    const reject = (code: RejectCode, message: string) => ({
      out: [{ target: { to: "one", sid } as Target, msg: { t: "rejected", opId, code, message } as const }],
      persist,
    });
    const author = this.peers.get(sid);
    if (author?.role === "viewer") return reject("forbidden", "You can view this bento, not edit it.");
    const holder = this.leases.get(op.id);
    const t = this.now();

    let upsert: Widget[] = [];
    let remove: string[] = [];

    switch (op.type) {
      case "create": {
        if (this.widgets.has(op.id)) return reject("exists", "That compartment already exists.");
        if (this.widgets.size >= MAX_WIDGETS) return reject("limit", "This bento is full.");
        const rect = clampRect(op.rect, NOTE_SIZE.min, NOTE_SIZE.max);
        const note: Widget = {
          id: op.id,
          kind: "note",
          ...rect,
          text: op.text,
          color: op.color,
          size: op.size,
          createdBy: author?.name ?? "someone",
          createdAt: t,
          updatedAt: t,
        };
        this.widgets.set(note.id, note);
        upsert = this.relayout(note.id);
        break;
      }
      case "move": {
        const w = this.widgets.get(op.id);
        if (!w) return reject("not_found", "That compartment is gone.");
        Object.assign(w, clampRect(op.rect, NOTE_SIZE.min, NOTE_SIZE.max), { updatedAt: t });
        upsert = this.relayout(w.id);
        break;
      }
      case "patch": {
        const w = this.widgets.get(op.id);
        if (!w) return reject("not_found", "That compartment is gone.");
        if (op.text !== undefined) {
          if (holder !== sid) return reject("leased", "Someone else is typing here.");
          w.text = op.text;
        }
        if (op.color !== undefined) w.color = op.color;
        if (op.size !== undefined) w.size = op.size;
        w.updatedAt = t;
        upsert = [w];
        break;
      }
      case "delete": {
        if (!this.widgets.has(op.id)) return reject("not_found", "That compartment is gone.");
        if (holder && holder !== sid) return reject("leased", "Someone is typing here.");
        this.widgets.delete(op.id);
        this.leases.delete(op.id);
        remove = [op.id];
        upsert = this.relayout();
        break;
      }
    }

    this.rev++;
    const textOnly = op.type === "patch" && op.color === undefined && op.size === undefined;
    for (const w of upsert) (textOnly ? persist.soon : persist.now).add(w.id);
    for (const id of remove) persist.removed.add(id);

    const out: Outgoing[] = [
      { target: { to: "all" }, msg: { t: "applied", rev: this.rev, by: sid, opId, upsert, remove } },
    ];
    if (op.type === "delete" && holder) {
      out.push({ target: { to: "all" }, msg: { t: "lease", id: op.id, holder: null } });
    }
    return { out, persist };
  }

  /**
   * Fills a new box with a few example notes ("starter" option). Returns the
   * ids to save.
   */
  seed(): string[] {
    const t = this.now();
    const notes: Array<Pick<Widget, "text" | "color" | "x" | "y" | "w" | "h">> = [
      {
        x: 0,
        y: 0,
        w: 4,
        h: 3,
        color: "tamago",
        text: "Welcome to the bento 🍱\nClick a note to write in it.",
      },
      { x: 4, y: 0, w: 3, h: 3, color: "sake", text: "Drag a note by its body.\nResize from the corner." },
      { x: 7, y: 0, w: 3, h: 2, color: "edamame", text: "Share the link: everyone types live." },
    ];
    const ids: string[] = [];
    notes.forEach((n, i) => {
      const id = `starter${i}${this.meta.id}`.slice(0, 24);
      this.widgets.set(id, {
        id,
        kind: "note",
        size: "m",
        createdBy: SYSTEM_AUTHOR,
        createdAt: t + i,
        updatedAt: t,
        ...n,
      });
      ids.push(id);
    });
    return ids;
  }

  /** Re-packs the box and returns every compartment that moved. */
  private relayout(anchorId?: string): Widget[] {
    const all = [...this.widgets.values()];
    const before = all.map(({ id, x, y, w, h }) => ({ id, x, y, w, h }));
    const after = settle(before, anchorId, { gravity: this.meta.options.autoPack });
    const moved = new Set(changedIds(before, after));
    if (anchorId) moved.add(anchorId);
    const out: Widget[] = [];
    for (const r of after) {
      if (!moved.has(r.id)) continue;
      const w = this.widgets.get(r.id)!;
      Object.assign(w, { x: r.x, y: r.y, w: r.w, h: r.h });
      out.push(w);
    }
    return out;
  }

  private leaseRecord(): Leases {
    return Object.fromEntries(this.leases);
  }
}
