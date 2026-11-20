import { DurableObject } from "cloudflare:workers";
import {
  CLOSE,
  DEFAULT_BOX_OPTIONS,
  parseClientMessage,
  randomId,
  type BoxMeta,
  type AssignableRole,
  type BoxOptions,
  type CreatedBox,
  type Peer,
  type ServerMessage,
  type Widget,
} from "@bentogether/shared";
import { Room, MAX_PEERS, type Outgoing, type Persist } from "./room";
import {
  FLUSH_MS,
  HELLO_TIMEOUT_MS,
  IDLE_MS,
  MAX_MESSAGE_BYTES,
  MAX_SOCKETS,
  MAX_SOCKETS_PER_IP,
  MESSAGE_BURST,
  MESSAGE_RATE,
  OP_BURST,
  OP_RATE,
  PASSWORD_SET_BURST,
  PASSWORD_SET_RATE,
  SETTINGS_BURST,
  SETTINGS_RATE,
  STRIKE_BURST,
  STRIKE_RATE,
  TokenBucket,
  WRITE_BURST,
  WRITE_RATE,
  ipKey,
  isQuotaError,
} from "./limits";

/** Survives hibernation on each socket. `at` is when it connected. */
type Attachment = { sid: string; peer: Peer | null; at?: number };

/** A connection's rate limits. In memory only: hibernation resets them. */
type Limits = { all: TokenBucket; op: TokenBucket; settings: TokenBucket; strikes: TokenBucket };

const SETTINGS = new Set(["rename", "retitle", "access", "options", "role", "clear"]);

/**
 * One Durable Object per box. It owns the box's state (SQLite), holds every
 * open WebSocket for it, and relays presence between them. The box's rules
 * live in `Room`; this class is the I/O shell around it.
 *
 * Uses the WebSocket Hibernation API: an idle box is evicted from memory
 * while sockets stay open, so a forgotten tab costs nothing. On wake the
 * constructor rebuilds the room from SQLite and the socket attachments.
 */
export class Box extends DurableObject<Env> {
  private room: Room | null = null;
  private limits = new Map<string, Limits>();
  /** Widgets changed or removed since the last flush. */
  private dirty = new Set<string>();
  private flushScheduled = false;
  private lastActivity = 0;
  private writes = new TokenBucket(WRITE_RATE, WRITE_BURST, Date.now());

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      // Looking up an id that was never created must not leave storage
      // behind, so only boxes that exist get their tables touched.
      if (!this.exists()) return;
      this.migrate();
      this.room = this.load();
      if (this.room) {
        for (const ws of ctx.getWebSockets()) {
          const a = ws.deserializeAttachment() as Attachment | null;
          if (a?.peer) this.room.restore(a.peer);
        }
      }
    });
    // Answer keep-alive pings without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
  }

  // ------------------------------------------------------------ RPC

  /** Creates the box. Called once by the Worker right after picking an id. */
  /**
   * Creates the bento. Returns its meta plus an owner token, the only time
   * the token exists in plain form: only its SHA-256 hash is stored.
   */
  async init(input: {
    id: string;
    title: string;
    options: BoxOptions;
    starter: boolean;
    creator?: { name: string; hue: number };
  }): Promise<CreatedBox | null> {
    if (this.room) return null;
    this.migrate();
    const meta: BoxMeta = {
      id: input.id,
      title: input.title,
      createdAt: Date.now(),
      options: input.options,
      ...(input.creator ? { creator: input.creator } : {}),
    };
    const ownerToken = randomId(32);
    this.ctx.storage.sql.exec("INSERT INTO meta (key, value) VALUES ('box', ?)", JSON.stringify(meta));
    this.ctx.storage.sql.exec("INSERT INTO meta (key, value) VALUES ('owner', ?)", await sha256(ownerToken));
    this.room = new Room(meta);
    if (input.starter) for (const id of this.room.seed()) this.write(id);
    return { ...meta, ownerToken };
  }

  /** Public summary: meta, counts, and the colors of who's here (no names). */
  async meta(): Promise<(BoxMeta & { people: number; widgetCount: number; hues: number[] }) | null> {
    if (!this.room) return null;
    return {
      ...this.room.meta,
      people: this.room.peers.size,
      widgetCount: this.room.widgets.size,
      hues: [...this.room.peers.values()].map((p) => p.hue),
    };
  }

  // ------------------------------------------------------- sockets

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    }
    // Cloudflare sets this header itself; clients can't forge it.
    const ip = ipKey(request.headers.get("CF-Connecting-IP") ?? "local");
    if (this.room) this.closeSilent();
    // Sockets just closed by the sweep above are still listed until they finish closing.
    const isOpen = (ws: WebSocket) => ws.readyState === WebSocket.OPEN;
    const total = this.ctx.getWebSockets().filter(isOpen).length;
    const fromIp = this.ctx.getWebSockets(ip).filter(isOpen).length;
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server, [ip]);
    // Refuse after accepting, so the browser gets a close code it can show
    // instead of an opaque failed handshake.
    if (!this.room) {
      server.close(CLOSE.notFound, "This bento doesn't exist");
    } else if (this.room.peers.size >= MAX_PEERS || total >= MAX_SOCKETS) {
      server.close(CLOSE.tooMany, "This bento is full");
    } else if (fromIp >= MAX_SOCKETS_PER_IP) {
      server.close(CLOSE.tooMany, "Too many tabs open on this bento");
    } else {
      server.serializeAttachment({ sid: randomId(10), peer: null, at: Date.now() } satisfies Attachment);
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    try {
      await this.handle(ws, data);
    } catch (err) {
      if (!isQuotaError(err)) throw err;
      // Out of daily quota: changes can't be saved, so say so to everyone
      // rather than letting them keep typing into a box that won't keep it.
      console.error("over capacity", err);
      this.closeAllOverCapacity();
    }
  }

  /** Ends every session in this box with `CLOSE.overCapacity`. Also used by `/__dev` locally. */
  async closeAllOverCapacity() {
    for (const s of this.ctx.getWebSockets()) {
      try {
        s.close(CLOSE.overCapacity, "over_capacity");
      } catch {
        // already closing
      }
    }
  }

  private async handle(ws: WebSocket, data: string | ArrayBuffer) {
    const room = this.room;
    const a = ws.deserializeAttachment() as Attachment | null;
    if (!room || !a) return;

    // Checked before parsing, so an oversized message costs nothing to refuse.
    if ((typeof data === "string" ? data.length : data.byteLength) > MAX_MESSAGE_BYTES) {
      ws.close(1009, "Message too big");
      return;
    }
    this.lastActivity = Date.now();
    const limits = this.limitsFor(a.sid);
    if (!limits.all.take(this.lastActivity)) return this.strike(ws, limits);

    let parsed;
    try {
      parsed = parseClientMessage(
        JSON.parse(typeof data === "string" ? data : new TextDecoder().decode(data)),
      );
    } catch {
      parsed = null;
    }
    if (!parsed?.success) {
      this.send(ws, { t: "error", code: "bad_message", message: "Message didn't match the protocol." });
      return this.strike(ws, limits);
    }
    const msg = parsed.output;

    if (msg.t === "op" && !limits.op.take(this.lastActivity)) {
      this.slowDown(ws, msg.opId);
      return this.strike(ws, limits);
    }
    if (SETTINGS.has(msg.t) && !limits.settings.take(this.lastActivity)) {
      if ("opId" in msg) this.slowDown(ws, msg.opId);
      return this.strike(ws, limits);
    }

    if (!a.peer && msg.t !== "hello") {
      ws.close(CLOSE.badHello, "Say hello first");
      return;
    }

    switch (msg.t) {
      case "hello": {
        if (a.peer) return;
        const owner = msg.ownerToken ? await this.isOwnerToken(msg.ownerToken) : false;
        if (!owner && room.access.mode === "password") {
          if (!this.allowPasswordTry()) {
            ws.close(CLOSE.tooMany, "Too many password attempts. Try again in a minute.");
            return;
          }
          if (!msg.password || !(await this.checkPassword(msg.password))) {
            ws.close(CLOSE.password, msg.password ? "wrong" : "required");
            return;
          }
        }
        const out = room.join(a.sid, msg, owner);
        ws.serializeAttachment({ sid: a.sid, peer: room.peers.get(a.sid)! } satisfies Attachment);
        this.dispatch(out);
        return;
      }
      case "op": {
        const { out, persist } = room.apply(a.sid, msg.opId, msg.op);
        this.save(persist);
        this.dispatch(out);
        return;
      }
      case "presence":
        this.dispatch(room.presence(a.sid, msg.presence));
        return;
      case "lease":
        this.dispatch(room.lease(a.sid, msg.id, msg.take));
        return;
      case "rename": {
        const out = room.rename(a.sid, msg.name);
        ws.serializeAttachment({ sid: a.sid, peer: room.peers.get(a.sid) ?? null } satisfies Attachment);
        this.dispatch(out);
        return;
      }
      case "retitle":
        this.dispatch(room.retitle(a.sid, msg.opId, msg.title));
        return;
      case "access": {
        if (room.peers.get(a.sid)?.role === "owner") {
          if (msg.password && !this.passwordSets.take(Date.now())) {
            this.slowDown(ws, msg.opId);
            return;
          }
          if (msg.password) await this.setPassword(msg.password);
          else if (msg.mode === "password" && !this.hasPassword()) {
            this.send(ws, {
              t: "rejected",
              opId: msg.opId,
              code: "invalid",
              message: "Set a password to protect this bento.",
            });
            return;
          }
        }
        this.dispatch(
          room.setAccess(a.sid, msg.opId, {
            ...(msg.mode ? { mode: msg.mode } : {}),
            ...(msg.defaultRole ? { defaultRole: msg.defaultRole } : {}),
          }),
        );
        return;
      }
      case "options":
        this.dispatch(
          room.setOptions(a.sid, msg.opId, {
            ...(msg.cursors !== undefined ? { cursors: msg.cursors } : {}),
            ...(msg.autoPack !== undefined ? { autoPack: msg.autoPack } : {}),
          }),
        );
        return;
      case "clear": {
        const { out, persist } = room.clear(a.sid, msg.opId);
        this.save(persist);
        this.dispatch(out);
        return;
      }
      case "role": {
        const out = room.setRole(a.sid, msg.opId, msg.sid, msg.role);
        this.saveRoles();
        // Roles live on the socket too, so they survive hibernation.
        for (const s of this.ctx.getWebSockets()) {
          const att = s.deserializeAttachment() as Attachment | null;
          const p = att && room.peers.get(att.sid);
          if (att && p) s.serializeAttachment({ sid: att.sid, peer: p } satisfies Attachment);
        }
        this.dispatch(out);
        return;
      }
      case "ping":
        this.send(ws, { t: "pong" });
        return;
    }
  }

  override async webSocketClose(ws: WebSocket, code: number) {
    this.drop(ws);
    try {
      ws.close(code === 1005 ? 1000 : code, "bye");
    } catch {
      // already closed
    }
  }

  override async webSocketError(ws: WebSocket) {
    this.drop(ws);
  }

  override async alarm() {
    this.flushScheduled = false;
    this.flushSafely();
    if (this.room) this.closeSilent();
  }

  // ------------------------------------------------------- internals

  private drop(ws: WebSocket) {
    const a = ws.deserializeAttachment() as Attachment | null;
    if (!a || !this.room) return;
    this.limits.delete(a.sid);
    this.dispatch(this.room.leave(a.sid), ws);
    if (this.room.peers.size === 0) this.flushSafely(true);
  }

  /**
   * Saving happens here rather than in the message handler, so this is where
   * running out of daily quota shows up. Same answer as there: tell everyone.
   * Unsaved changes stay pending for the next flush.
   */
  private flushSafely(all = false) {
    try {
      this.flush(all);
    } catch (err) {
      if (!isQuotaError(err)) throw err;
      console.error("over capacity", err);
      void this.closeAllOverCapacity();
    }
  }

  /** Closes sockets that connected but never said hello. */
  private closeSilent() {
    const cutoff = Date.now() - HELLO_TIMEOUT_MS;
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (!a || a.peer || (a.at ?? 0) > cutoff) continue;
      try {
        ws.close(CLOSE.badHello, "Say hello first");
      } catch {
        // already closing
      }
    }
  }

  private async isOwnerToken(token: string): Promise<boolean> {
    const row = this.ctx.storage.sql
      .exec<{ value: string }>("SELECT value FROM meta WHERE key = 'owner'")
      .toArray()[0];
    return !!row && timingSafeEqual(row.value, await sha256(token));
  }

  private limitsFor(sid: string): Limits {
    let l = this.limits.get(sid);
    if (!l) {
      const now = Date.now();
      l = {
        all: new TokenBucket(MESSAGE_RATE, MESSAGE_BURST, now),
        op: new TokenBucket(OP_RATE, OP_BURST, now),
        settings: new TokenBucket(SETTINGS_RATE, SETTINGS_BURST, now),
        strikes: new TokenBucket(STRIKE_RATE, STRIKE_BURST, now),
      };
      this.limits.set(sid, l);
    }
    return l;
  }

  /** Counts a dropped message; a connection that keeps at it is closed. */
  private strike(ws: WebSocket, limits: Limits) {
    if (!limits.strikes.take(Date.now())) ws.close(CLOSE.tooMany, "Too many messages");
  }

  private slowDown(ws: WebSocket, opId: string) {
    this.send(ws, { t: "rejected", opId, code: "rate_limited", message: "Slow down a little." });
  }

  private dispatch(out: Outgoing[], skip?: WebSocket) {
    if (out.length === 0) return;
    if (out.some((o) => o.msg.t === "meta")) {
      // Renamed, settings or the creator's credit changed: save it.
      this.ctx.storage.sql.exec(
        "UPDATE meta SET value = ? WHERE key = 'box'",
        JSON.stringify(this.room!.meta),
      );
    }
    const sockets = this.ctx.getWebSockets().filter((ws) => ws !== skip);
    const sidOf = new Map(sockets.map((ws) => [ws, (ws.deserializeAttachment() as Attachment | null)?.sid]));
    for (const { target, msg } of out) {
      const payload = JSON.stringify(msg);
      for (const ws of sockets) {
        const sid = sidOf.get(ws);
        if (!sid) continue;
        const peer = this.room?.peers.has(sid);
        if (target.to === "one" ? sid !== target.sid : !peer) continue;
        if (target.to === "others" && sid === target.except) continue;
        this.sendRaw(ws, payload);
      }
    }
  }

  private send(ws: WebSocket, msg: ServerMessage) {
    this.sendRaw(ws, JSON.stringify(msg));
  }

  private sendRaw(ws: WebSocket, payload: string) {
    try {
      ws.send(payload);
    } catch {
      // Socket is closing; its close handler cleans up.
    }
  }

  // ------------------------------------------------------- storage

  private exists(): boolean {
    return (
      this.ctx.storage.sql
        .exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'")
        .toArray().length > 0
    );
  }

  private migrate() {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS widgets (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL);
    `);
  }

  private load(): Room | null {
    const row = this.ctx.storage.sql
      .exec<{ value: string }>("SELECT value FROM meta WHERE key = 'box'")
      .toArray()[0];
    if (!row) return null;
    const widgets = this.ctx.storage.sql
      .exec<{ data: string }>("SELECT data FROM widgets")
      .toArray()
      .map((r) => JSON.parse(r.data) as Widget);
    const stored = JSON.parse(row.value) as Omit<BoxMeta, "options"> & { options?: Partial<BoxOptions> };
    // Boxes made before options existed get the defaults.
    const meta: BoxMeta = { ...stored, options: { ...DEFAULT_BOX_OPTIONS, ...stored.options } };
    const rolesRow = this.ctx.storage.sql
      .exec<{ value: string }>("SELECT value FROM meta WHERE key = 'roles'")
      .toArray()[0];
    const roles = rolesRow ? (Object.entries(JSON.parse(rolesRow.value)) as [string, AssignableRole][]) : [];
    return new Room(meta, widgets, Date.now, roles);
  }

  private saveRoles() {
    if (!this.room) return;
    this.ctx.storage.sql.exec(
      "INSERT INTO meta (key, value) VALUES ('roles', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      JSON.stringify(Object.fromEntries(this.room.roles)),
    );
  }

  // ------------------------------------------------------- passwords

  /** PBKDF2-SHA256, random salt, stored as "salt:hash". The password never is. */
  private async setPassword(password: string) {
    const salt = randomId(16);
    const hash = await pbkdf2(password, salt);
    this.ctx.storage.sql.exec(
      "INSERT INTO meta (key, value) VALUES ('password', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      `${salt}:${hash}`,
    );
  }

  private hasPassword(): boolean {
    return this.ctx.storage.sql.exec("SELECT 1 FROM meta WHERE key = 'password'").toArray().length > 0;
  }

  private async checkPassword(password: string): Promise<boolean> {
    const row = this.ctx.storage.sql
      .exec<{ value: string }>("SELECT value FROM meta WHERE key = 'password'")
      .toArray()[0];
    if (!row) return false;
    const [salt, hash] = row.value.split(":") as [string, string];
    return timingSafeEqual(hash, await pbkdf2(password, salt));
  }

  /** A bento-wide brake on guessing: 20 tries a minute across all comers. */
  private passwordTries = new TokenBucket(20 / 60, 20, Date.now());
  private passwordSets = new TokenBucket(PASSWORD_SET_RATE, PASSWORD_SET_BURST, Date.now());
  private allowPasswordTry(): boolean {
    return this.passwordTries.take(Date.now());
  }

  /**
   * Every change is applied in memory and sent to everyone at once; saving
   * it waits for the next flush. A widget dragged or retyped many
   * times in that window is written once, so writes follow how much of the
   * board changed, not how many messages arrived.
   */
  private save(persist: Persist) {
    for (const set of [persist.now, persist.soon, persist.removed]) for (const id of set) this.dirty.add(id);
    if (this.dirty.size > 0) this.scheduleFlush();
  }

  private scheduleFlush() {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    void this.ctx.storage.setAlarm(Date.now() + FLUSH_MS);
  }

  /**
   * Writes pending changes. While the box is busy it writes only what the
   * write budget allows and comes back for the rest; once it's idle (or
   * `all`), it writes everything, so nothing is lost when it hibernates.
   */
  private flush(all = false) {
    const now = Date.now();
    const idle = all || now - this.lastActivity >= IDLE_MS;
    for (const id of this.dirty) {
      if (!this.writes.take(now) && !idle) break;
      this.write(id);
      this.dirty.delete(id);
    }
    if (this.dirty.size > 0) this.scheduleFlush();
  }

  /** Saves a widget as it is now, or deletes its row if it's gone. */
  private write(id: string) {
    const w = this.room?.widgets.get(id);
    if (!w) {
      this.ctx.storage.sql.exec("DELETE FROM widgets WHERE id = ?", id);
      return;
    }
    this.ctx.storage.sql.exec(
      "INSERT INTO widgets (id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
      w.id,
      JSON.stringify(w),
      w.updatedAt,
    );
  }
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time compare of two equal-length hex digests. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function pbkdf2(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: 100_000 },
    key,
    256,
  );
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
