import {
  EMPTY_PRESENCE,
  applyBudgetChange,
  applyTodoChange,
  applyWidgetChange,
  blankFields,
  mayDelete,
  viewerMay,
  voterKey,
  clampFor,
  settle,
  sameName,
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
import { starterBento } from "./template";

export const MAX_WIDGETS = 300;
export const MAX_PEERS = 32;
/**
 * A note's typist counts as away after this long without typing or moving
 * their caret, and the next person to click in takes the note over. What
 * they typed is already saved; nobody is cut off mid-sentence.
 */
export const LEASE_IDLE_MS = 30_000;

/** Where an outgoing message goes. */
export type Target = { to: "all" } | { to: "others"; except: string } | { to: "one"; sid: string };
export type Outgoing = { target: Target; msg: ServerMessage };

export type Hello = { clientId: string; name: string; hue: number };

/** What the room asks its host to save after handling a message. */
export type Persist = {
  /**
   * Any change someone waits on a confirmation for (create, move, color,
   * a list item, a vote, a title): saved before the confirmation goes out.
   */
  now: Set<string>;
  /** Text typed into a note, sent every 80ms while typing: saved soon, coalesced. */
  soon: Set<string>;
  /** Deleted widgets: their rows are removed before the confirmation goes out. */
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
  /** When each lease's holder last typed or moved their caret in it. */
  private leaseActive = new Map<string, number>();
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
          now: this.now(),
        },
      },
      { target: { to: "others", except: sid }, msg: { t: "join", peer: this.public(peer) } },
      ...credit,
    ];
  }

  /**
   * Names are unique within a bento. Your own other tabs (same device)
   * don't count, so reconnecting or opening a second tab never clashes.
   */
  nameTaken(name: string, clientId: string): boolean {
    for (const p of this.peers.values()) {
      if (p.clientId !== clientId && sameName(p.name, name)) return true;
    }
    return false;
  }

  /**
   * Restores a peer, and the notes they were typing in with when they last
   * typed there, after the Durable Object wakes from hibernation. Keeping
   * that time matters: a quiet box hibernates well before a typist counts as
   * idle, and restarting the clock at wake would mean a quiet note could
   * never be taken over.
   */
  restore(peer: Peer, leases: Record<string, number> = {}) {
    this.peers.set(peer.sid, { ...peer, presence: EMPTY_PRESENCE });
    for (const [id, active] of Object.entries(leases)) {
      if (this.widgets.get(id)?.kind !== "note" || this.leases.has(id)) continue;
      this.leases.set(id, peer.sid);
      this.leaseActive.set(id, active);
    }
  }

  /** The notes a peer is typing in and when they last did, for the host to keep on their socket. */
  leasesOf(sid: string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [id, holder] of this.leases) if (holder === sid) out[id] = this.leaseActive.get(id) ?? 0;
    return out;
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
    // Taken: keep the old name and tell only them, which undoes it there.
    if (this.nameTaken(name, peer.clientId)) {
      return [
        {
          target: { to: "one", sid },
          msg: { t: "peer", sid, name: peer.name, hue: peer.hue, role: peer.role },
        },
      ];
    }
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
    if (caret) this.leaseActive.set(caret.id, this.now());
    const drag = presence.drag && this.widgets.has(presence.drag.id) ? presence.drag : null;
    // Cursors off is a box rule, not a client preference: positions never leave the server.
    const cursor = this.meta.options.cursors ? presence.cursor : null;
    peer.presence = { ...presence, cursor, caret, drag };
    return [{ target: { to: "others", except: sid }, msg: { t: "presence", sid, presence: peer.presence } }];
  }

  // ------------------------------------------------------------- leases

  /**
   * One person types in a note at a time; everyone else watches live. A
   * holder who has been idle for `LEASE_IDLE_MS` loses the note to the next
   * person who asks. Their client sees the new holder and ends their edit.
   */
  lease(sid: string, id: string, take: boolean): Outgoing[] {
    const holder = this.leases.get(id);
    if (take) {
      // Only notes are typed in by one person at a time.
      if (this.widgets.get(id)?.kind !== "note") return [];
      // Viewers watch; the answer "nobody holds it, and not you" ends their wait.
      if (this.peers.get(sid)?.role === "viewer") {
        return [{ target: { to: "one", sid }, msg: { t: "lease", id, holder: holder ?? null } }];
      }
      const idle = this.now() - (this.leaseActive.get(id) ?? 0) >= LEASE_IDLE_MS;
      if (holder && holder !== sid && !idle) {
        return [{ target: { to: "one", sid }, msg: { t: "lease", id, holder } }];
      }
      if (holder === sid) return [];
      this.leases.set(id, sid);
      this.leaseActive.set(id, this.now());
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
    // Viewers may only vote (a poll, an Ideas upvote).
    const viewerVote = op.type === "change" && viewerMay(op.change);
    if (author?.role === "viewer" && !viewerVote)
      return reject("forbidden", "You can view this bento, not edit it.");
    const holder = this.leases.get(op.id);
    const t = this.now();

    let upsert: Widget[] = [];
    let remove: string[] = [];

    switch (op.type) {
      case "create": {
        if (this.widgets.has(op.id)) return reject("exists", "That widget already exists.");
        if (this.widgets.size >= MAX_WIDGETS) return reject("limit", "This bento is full.");
        const rect = clampFor(op.kind, op.rect);
        const stamp = {
          createdBy: author?.name ?? "someone",
          creatorKey: voterKey(author?.clientId ?? sid, this.meta.id),
          createdAt: t,
          updatedAt: t,
        };
        const base = { id: op.id, ...rect, color: op.color, ...stamp };
        const widget: Widget =
          op.kind === "note"
            ? { ...base, kind: "note", text: op.text, size: op.size }
            : op.kind === "todo"
              ? { ...base, kind: "todo", title: op.title, items: [] }
              : op.kind === "budget"
                ? { ...base, kind: "budget", title: op.title, currency: op.currency, amount: 0, log: [] }
                : ({ ...base, title: op.title, ...blankFields(op.kind, t) } as Widget);
        this.widgets.set(widget.id, widget);
        upsert = this.relayout(widget.id);
        break;
      }
      case "move": {
        const w = this.widgets.get(op.id);
        if (!w) return reject("not_found", "That widget is gone.");
        Object.assign(w, clampFor(w.kind, op.rect), { updatedAt: t });
        upsert = this.relayout(w.id);
        break;
      }
      case "patch": {
        const w = this.widgets.get(op.id);
        if (!w) return reject("not_found", "That widget is gone.");
        if (op.currency !== undefined && w.kind !== "budget")
          return reject("invalid", "Only a budget has a currency.");
        if (w.kind === "note") {
          if (op.title !== undefined) return reject("invalid", "Notes don't have a title.");
          if (op.text !== undefined) {
            if (holder !== sid) return reject("leased", "Someone else is typing here.");
            w.text = op.text;
            this.leaseActive.set(op.id, t);
          }
          if (op.size !== undefined) w.size = op.size;
        } else {
          if (op.text !== undefined || op.size !== undefined)
            return reject("invalid", "That only applies to a note.");
          // Short and set in one go, so the last one saved wins.
          if (op.title !== undefined) w.title = op.title.trim();
          if (op.currency !== undefined && w.kind === "budget") w.currency = op.currency;
        }
        if (op.color !== undefined) w.color = op.color;
        w.updatedAt = t;
        upsert = [w];
        break;
      }
      case "item": {
        const w = this.widgets.get(op.id);
        if (!w) return reject("not_found", "That widget is gone.");
        if (w.kind !== "todo") return reject("invalid", "That widget has no list.");
        const result = applyTodoChange(w.items, op.change, author?.name ?? "someone", t);
        if ("code" in result) return reject(result.code, result.message);
        w.items = result.items;
        w.updatedAt = t;
        upsert = [w];
        break;
      }
      case "budget": {
        const w = this.widgets.get(op.id);
        if (!w) return reject("not_found", "That widget is gone.");
        if (w.kind !== "budget") return reject("invalid", "That widget isn't a budget.");
        const who = { name: author?.name ?? "someone", hue: author?.hue ?? 0 };
        const result = applyBudgetChange(w, op.change, who, t);
        if ("code" in result) return reject(result.code, result.message);
        w.amount = result.amount;
        w.log = result.log;
        w.updatedAt = t;
        upsert = [w];
        break;
      }
      case "change": {
        const w = this.widgets.get(op.id);
        if (!w) return reject("not_found", "That widget is gone.");
        const ctx = {
          name: author?.name ?? "someone",
          hue: author?.hue ?? 0,
          voter: voterKey(author?.clientId ?? sid, this.meta.id),
          now: t,
        };
        const result = applyWidgetChange(w, op.change, ctx);
        if ("code" in result) return reject(result.code, result.message);
        const next = { ...result, updatedAt: t };
        this.widgets.set(w.id, next);
        upsert = [next];
        break;
      }
      case "delete": {
        const w = this.widgets.get(op.id);
        if (!w) return reject("not_found", "That widget is gone.");
        if (!mayDelete(w, author?.role ?? "viewer", voterKey(author?.clientId ?? sid, this.meta.id)))
          return reject("forbidden", "Only the bento's creator or whoever added this widget can delete it.");
        if (holder && holder !== sid) return reject("leased", "Someone is typing here.");
        this.widgets.delete(op.id);
        this.leases.delete(op.id);
        remove = [op.id];
        upsert = this.relayout();
        break;
      }
    }

    this.rev++;
    // Only a note's streamed text is coalesced. A list title is set in one go
    // and its sender waits for the answer, so it's saved like any other change.
    const textOnly =
      op.type === "patch" && op.text !== undefined && op.color === undefined && op.size === undefined;
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
   * Empties the bento: every widget goes, for everyone, along with anyone's
   * typing in them. Owner only; the client asks them to confirm first.
   */
  clear(sid: string, opId: string): { out: Outgoing[]; persist: Persist } {
    const persist: Persist = { now: new Set(), soon: new Set(), removed: new Set() };
    const denied = this.ownerOnly(sid, opId, "clear it");
    if (denied) return { out: denied, persist };
    const remove = [...this.widgets.keys()];
    const leased = [...this.leases.keys()];
    this.widgets.clear();
    this.leases.clear();
    for (const id of remove) persist.removed.add(id);
    this.rev++;
    return {
      out: [
        { target: { to: "all" }, msg: { t: "applied", rev: this.rev, by: sid, opId, upsert: [], remove } },
        ...leased.map((id): Outgoing => ({ target: { to: "all" }, msg: { t: "lease", id, holder: null } })),
      ],
      persist,
    };
  }

  /**
   * Fills a new box with the base template ("starter" option): one of every
   * widget, as an example. Returns the ids to save.
   */
  seed(): string[] {
    const widgets = starterBento(this.meta.id, this.now());
    for (const w of widgets) this.widgets.set(w.id, w);
    return widgets.map((w) => w.id);
  }

  /** Re-packs the box and returns every widget that moved. */
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
