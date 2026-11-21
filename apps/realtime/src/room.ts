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
  applyText,
  transformText,
  DEFAULT_ACCESS,
  NOTE_TEXT_MAX,
  type Access,
  type AssignableRole,
  type BoxMeta,
  type Op,
  type Peer,
  type Presence,
  type RejectCode,
  type Role,
  type ServerMessage,
  type TextOp,
  type Widget,
} from "@bentogether/shared";
import { starterBento } from "./template";

export const MAX_WIDGETS = 300;
export const MAX_PEERS = 32;
/**
 * Typed edits each note remembers, so an edit typed against an older
 * version can be moved past what came since. In memory only: after the
 * object hibernates, an edit older than the saved text is refused as
 * stale, and its typist keeps their words to copy.
 */
export const TEXT_HISTORY = 200;

/** One typed edit the server applied, as everyone received it. */
type TextEntry = { v: number; ops: TextOp; by: string; opId: string };

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
  /** Text typed into a note, streamed as people type: saved soon, coalesced. */
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
  /** Recent typed edits per note, oldest first (see TEXT_HISTORY). */
  private history = new Map<string, TextEntry[]>();
  /** Roles the owner gave, by device (clientId). Persisted by the host. */
  readonly roles = new Map<string, AssignableRole>();

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

  /** Restores a peer after the Durable Object wakes from hibernation. */
  restore(peer: Peer) {
    this.peers.set(peer.sid, { ...peer, presence: EMPTY_PRESENCE });
  }

  leave(sid: string): Outgoing[] {
    if (!this.peers.delete(sid)) return [];
    return [{ target: { to: "all" }, msg: { t: "leave", sid } }];
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
   * Gives someone at the table a role, remembered for their device. A new
   * viewer's typing in flight is refused from then on. Owner only.
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
    // A caret only counts inside a note, and not from a viewer; a drag only on a real widget.
    const caret =
      presence.caret && peer.role !== "viewer" && this.widgets.get(presence.caret.id)?.kind === "note"
        ? presence.caret
        : null;
    const drag = presence.drag && this.widgets.has(presence.drag.id) ? presence.drag : null;
    // Cursors off is a box rule, not a client preference: positions never leave the server.
    const cursor = this.meta.options.cursors ? presence.cursor : null;
    peer.presence = { ...presence, cursor, caret, drag };
    return [{ target: { to: "others", except: sid }, msg: { t: "presence", sid, presence: peer.presence } }];
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
          if (op.size !== undefined) w.size = op.size;
        } else {
          if (op.size !== undefined) return reject("invalid", "That only applies to a note.");
          if (op.currency !== undefined && w.kind === "budget") w.currency = op.currency;
        }
        // Short and set in one go, so the last one saved wins.
        if (op.title !== undefined) w.title = op.title.trim();
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
      case "text":
        return this.text(sid, opId, op, t, reject, persist);
      case "delete": {
        const w = this.widgets.get(op.id);
        if (!w) return reject("not_found", "That widget is gone.");
        if (!mayDelete(w, author?.role ?? "viewer", voterKey(author?.clientId ?? sid, this.meta.id)))
          return reject("forbidden", "Only the bento's creator or whoever added this widget can delete it.");
        if (this.typists(op.id).some((p) => p.sid !== sid)) return reject("busy", "Someone is typing here.");
        this.widgets.delete(op.id);
        this.history.delete(op.id);
        remove = [op.id];
        upsert = this.relayout();
        break;
      }
    }

    for (const w of upsert) persist.now.add(w.id);
    for (const id of remove) persist.removed.add(id);

    const out: Outgoing[] = [{ target: { to: "all" }, msg: { t: "applied", by: sid, opId, upsert, remove } }];
    return { out, persist };
  }

  /** People whose caret is in a note right now. */
  private typists(id: string): Peer[] {
    return [...this.peers.values()].filter((p) => p.presence.caret?.id === id);
  }

  /**
   * A typed edit. Made against version `base` of the note's text, it's moved
   * past every edit applied since (they go first where both insert at one
   * spot), applied, and sent to everyone as the next version. Saved soon,
   * coalesced, like all typing.
   */
  private text(
    sid: string,
    opId: string,
    op: Extract<Op, { type: "text" }>,
    t: number,
    reject: (code: RejectCode, message: string) => { out: Outgoing[]; persist: Persist },
    persist: Persist,
  ): { out: Outgoing[]; persist: Persist } {
    const w = this.widgets.get(op.id);
    if (!w) return reject("not_found", "That note is gone.");
    if (w.kind !== "note") return reject("invalid", "Only a note has text to type in.");
    const version = w.tv ?? 0;
    if (op.base > version) return reject("invalid", "That edit is from a version that doesn't exist.");
    const history = this.history.get(op.id) ?? [];
    // history[i] is version `first + i`; everything after `base` is needed.
    const first = version - history.length + 1;
    if (op.base + 1 < first) return reject("stale", "The note changed too much while you were away.");
    const missed = history.slice(op.base + 1 - first);

    const out: Outgoing[] = [];
    if (op.resend) {
      // A reconnecting typist catches up on what they missed, in order. If
      // their edit is among it, it was applied before they lost the line.
      for (const e of missed) {
        out.push({ target: { to: "one", sid }, msg: { t: "text", id: op.id, ...e } });
      }
      if (missed.some((e) => e.opId === opId)) return { out, persist };
    }

    let ops = op.ops;
    for (const e of missed) ops = transformText(ops, e.ops, "right");
    let next: string;
    try {
      next = applyText(w.text, ops);
    } catch {
      return reject("invalid", "That edit doesn't fit the note.");
    }
    if (next.length > NOTE_TEXT_MAX) return reject("limit", "This note is full.");

    w.text = next;
    w.tv = version + 1;
    w.updatedAt = t;
    const entry: TextEntry = { v: w.tv, ops, by: sid, opId };
    history.push(entry);
    if (history.length > TEXT_HISTORY) history.shift();
    this.history.set(op.id, history);
    persist.soon.add(op.id);
    out.push({ target: { to: "all" }, msg: { t: "text", id: op.id, ...entry } });
    return { out, persist };
  }

  /**
   * Empties the bento: every widget goes, for everyone, typing in progress
   * included. Owner only; the client asks them to confirm first.
   */
  clear(sid: string, opId: string): { out: Outgoing[]; persist: Persist } {
    const persist: Persist = { now: new Set(), soon: new Set(), removed: new Set() };
    const denied = this.ownerOnly(sid, opId, "clear it");
    if (denied) return { out: denied, persist };
    const remove = [...this.widgets.keys()];
    this.widgets.clear();
    this.history.clear();
    for (const id of remove) persist.removed.add(id);
    return {
      out: [{ target: { to: "all" }, msg: { t: "applied", by: sid, opId, upsert: [], remove } }],
      persist,
    };
  }

  /**
   * Whether `sid` may delete the bento: null if so, else the rejection to
   * send. Deleting itself is the host's job (it wipes storage).
   */
  mayDelete(sid: string, opId: string): Outgoing[] | null {
    return this.ownerOnly(sid, opId, "delete it");
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
}
