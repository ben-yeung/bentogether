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
import { isQuotaError, MAX_STRIKES, MESSAGE_BURST, MESSAGE_RATE, TokenBucket } from "./limits";

/** Text typed into notes is saved at most this often. */
const TEXT_FLUSH_MS = 1500;

/** Survives hibernation on each socket. */
type Attachment = { sid: string; peer: Peer | null };

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
  private buckets = new Map<string, TokenBucket>();
  private strikes = new Map<string, number>();
  private pendingText = new Set<string>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
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
  async meta(): Promise<(BoxMeta & { people: number; compartments: number; hues: number[] }) | null> {
    if (!this.room) return null;
    return {
      ...this.room.meta,
      people: this.room.peers.size,
      compartments: this.room.widgets.size,
      hues: [...this.room.peers.values()].map((p) => p.hue),
    };
  }

  // ------------------------------------------------------- sockets

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    }
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    // Refuse after accepting, so the browser gets a close code it can show
    // instead of an opaque failed handshake.
    if (!this.room) {
      server.close(CLOSE.notFound, "This bento doesn't exist");
    } else if (this.room.peers.size >= MAX_PEERS) {
      server.close(CLOSE.tooMany, "This bento is full");
    } else {
      server.serializeAttachment({ sid: randomId(10), peer: null } satisfies Attachment);
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

    if (!this.allow(a.sid)) {
      if ((this.strikes.get(a.sid) ?? 0) > MAX_STRIKES) ws.close(CLOSE.tooMany, "Too many messages");
      return;
    }

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
      return;
    }
    const msg = parsed.output;

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
    this.flushText();
  }

  // ------------------------------------------------------- internals

  private drop(ws: WebSocket) {
    const a = ws.deserializeAttachment() as Attachment | null;
    if (!a || !this.room) return;
    this.buckets.delete(a.sid);
    this.strikes.delete(a.sid);
    this.dispatch(this.room.leave(a.sid), ws);
    if (this.room.peers.size === 0) this.flushText();
  }

  private async isOwnerToken(token: string): Promise<boolean> {
    const row = this.ctx.storage.sql
      .exec<{ value: string }>("SELECT value FROM meta WHERE key = 'owner'")
      .toArray()[0];
    return !!row && timingSafeEqual(row.value, await sha256(token));
  }

  private allow(sid: string): boolean {
    const now = Date.now();
    let bucket = this.buckets.get(sid);
    if (!bucket) this.buckets.set(sid, (bucket = new TokenBucket(MESSAGE_RATE, MESSAGE_BURST, now)));
    if (bucket.take(now)) return true;
    this.strikes.set(sid, (this.strikes.get(sid) ?? 0) + 1);
    return false;
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
  private allowPasswordTry(): boolean {
    return this.passwordTries.take(Date.now());
  }

  private save(persist: Persist) {
    for (const id of persist.removed) {
      this.pendingText.delete(id);
      this.ctx.storage.sql.exec("DELETE FROM widgets WHERE id = ?", id);
    }
    for (const id of persist.now) {
      this.pendingText.delete(id);
      this.write(id);
    }
    if (persist.soon.size > 0) {
      for (const id of persist.soon) this.pendingText.add(id);
      void this.ctx.storage.getAlarm().then((at) => {
        if (at === null) void this.ctx.storage.setAlarm(Date.now() + TEXT_FLUSH_MS);
      });
    }
  }

  private flushText() {
    for (const id of this.pendingText) this.write(id);
    this.pendingText.clear();
  }

  private write(id: string) {
    const w = this.room?.widgets.get(id);
    if (!w) return;
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
