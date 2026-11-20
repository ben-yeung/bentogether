import { CLOSE, type ClientMessage, type ServerMessage } from "@bentogether/shared";

export type SocketStatus = "connecting" | "open" | "reconnecting" | "closed";

export type SocketOptions = {
  url: string;
  /** Sent first on every (re)connect. */
  hello: () => ClientMessage;
  onMessage: (msg: ServerMessage) => void;
  onStatus: (status: SocketStatus, close?: { code: number; reason: string }) => void;
  /** Close codes that mean "stop trying" (missing box, full table). */
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
    const ws = new WebSocket(this.opts.url);
    this.ws = ws;

    ws.onopen = () => {
      this.attempt = 0;
      ws.send(JSON.stringify(this.opts.hello()));
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.send({ t: "ping" }), PING_MS);
    };

    ws.onmessage = (e) => {
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
      clearInterval(this.pingTimer);
      if (this.ws !== ws || this.stopped) return;
      const fatal = this.opts.fatalCodes ?? [CLOSE.notFound, CLOSE.tooMany, CLOSE.forbidden, CLOSE.password];
      if (fatal.includes(e.code)) {
        this.stopped = true;
        this.opts.onStatus("closed", { code: e.code, reason: e.reason });
        return;
      }
      this.scheduleRetry();
    };
  }

  private scheduleRetry() {
    this.opts.onStatus("reconnecting");
    const base = Math.min(MAX_BACKOFF_MS, 400 * 2 ** this.attempt++);
    this.retryTimer = setTimeout(() => this.connect(), base / 2 + Math.random() * (base / 2));
  }

  private onOnline = () => {
    if (this.stopped || this.isOpen) return;
    clearTimeout(this.retryTimer);
    this.attempt = 0;
    this.connect();
  };
}
