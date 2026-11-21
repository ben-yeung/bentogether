import { CLOSE, type ClientMessage, type ServerMessage } from "@bentogether/shared";

export type SocketStatus = "connecting" | "open" | "reconnecting" | "closed";

export type SocketOptions = {
  url: string;
  /** Sent first on every (re)connect. */
  hello: () => ClientMessage;
  onMessage: (msg: ServerMessage) => void;
  onStatus: (status: SocketStatus, close?: { code: number; reason: string }) => void;
  /** Close codes that mean "stop trying" (missing box, full bento, out of capacity). */
  fatalCodes?: readonly number[];
};

const PING_MS = 25_000;
const MAX_BACKOFF_MS = 8_000;

/**
 * A WebSocket that reconnects with jittered exponential backoff, says hello
 * on every connection, and keeps itself alive with pings the Durable
 * Object answers without waking up.
 *
 * Plain imperative code on purpose: the reactive layer (`board/session.ts`)
 * subscribes to it, so this file has no Solid imports and is easy to test.
 */
export class Socket {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private stopped = false;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly opts: SocketOptions) {
    this.connect();
    addEventListener("online", this.onOnline);
  }

  get isOpen() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  send(msg: ClientMessage): boolean {
    if (!this.isOpen) return false;
    this.ws!.send(JSON.stringify(msg));
    return true;
  }

  close() {
    this.stopped = true;
    removeEventListener("online", this.onOnline);
    clearTimeout(this.retryTimer);
    clearInterval(this.pingTimer);
    this.ws?.close(1000, "bye");
  }

  // Never reports status synchronously: the socket is created inside a
  // reactive computation, where Solid 2.0 forbids writes. Status changes
  // only arrive from socket events and timers.
  private connect() {
    this.retire();
    const ws = new WebSocket(this.opts.url);
    this.ws = ws;

    // Every handler checks it still belongs to the current connection: one
    // replaced while connecting (say, by \`online\`) must not say hello or
    // deliver messages, or the box would see you twice.
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.attempt = 0;
      ws.send(JSON.stringify(this.opts.hello()));
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.send({ t: "ping" }), PING_MS);
    };

    ws.onmessage = (e) => {
      if (this.ws !== ws) return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(e.data as string) as ServerMessage;
      } catch {
        return;
      }
      if (msg.t === "welcome") this.opts.onStatus("open");
      this.opts.onMessage(msg);
    };

    ws.onclose = (e) => {
      if (this.ws !== ws || this.stopped) return;
      clearInterval(this.pingTimer);
      const fatal = this.opts.fatalCodes ?? [
        CLOSE.notFound,
        CLOSE.tooMany,
        CLOSE.forbidden,
        CLOSE.password,
        CLOSE.nameTaken,
        CLOSE.overCapacity,
        CLOSE.outdated,
      ];
      if (fatal.includes(e.code)) {
        this.stopped = true;
        this.opts.onStatus("closed", { code: e.code, reason: e.reason });
        return;
      }
      this.scheduleRetry();
    };
  }

  /** Detaches and closes the current connection, if any, before a new one. */
  private retire() {
    const old = this.ws;
    if (!old) return;
    this.ws = null;
    clearInterval(this.pingTimer);
    old.onopen = old.onmessage = old.onclose = null;
    if (old.readyState === WebSocket.CONNECTING || old.readyState === WebSocket.OPEN) {
      old.close(1000, "replaced");
    }
  }

  private scheduleRetry() {
    this.opts.onStatus("reconnecting");
    const base = Math.min(MAX_BACKOFF_MS, 400 * 2 ** this.attempt++);
    this.retryTimer = setTimeout(() => this.connect(), base / 2 + Math.random() * (base / 2));
  }

  /**
   * Back online: retry now rather than wait out the backoff. A connection
   * still trying is replaced, since it began while offline and may hang.
   */
  private onOnline = () => {
    if (this.stopped || this.isOpen) return;
    clearTimeout(this.retryTimer);
    this.attempt = 0;
    this.connect();
  };
}
