# benTogether

**Pack ideas into a bento together.** A live, multiplayer note board: share a link and everyone
sees notes move, words appear and cursors glide as it happens.

Built with [Solid 2.0](https://www.solidjs.com/) and Cloudflare Durable Objects.
More detail: [Solid 2.0 notes](docs/SOLID-2.md) · [brand guide](docs/BRAND.md).

## Features

- Live cursors, typing carets and drag previews for everyone in a bento
- Sticky notes: add, drag, resize, recolor, set text size
- Share via link, with Can edit / Can view roles and optional password
- Creator-only settings: live cursors, auto-pack
- Light and dark themes

## Architecture

```
 Browser (Solid 2.0 SPA, Vercel)            Cloudflare
 ┌──────────────────────────────┐   wss    ┌──────────────────────────────────────┐
 │ session.ts                   │ ───────▶ │ Worker (index.ts)                    │
 │  server store  ◀── messages  │          │  CORS/origin check, create box,      │
 │  optimistic overlay (actions)│          │  route socket → Durable Object       │
 │  presence (20 Hz, coalesced) │          │                                      │
 │ Board / Note / Cursors       │ ◀─────── │ Box Durable Object (box.ts), 1 per box│
 └──────────────────────────────┘          │  Room (room.ts): pure rules          │
                                           │  SQLite storage, hibernating sockets │
                                           └──────────────────────────────────────┘
          packages/shared: protocol (valibot), grid, layout engine, identity
```

| Path              | What                                                                 |
| ----------------- | -------------------------------------------------------------------- |
| `packages/shared` | Wire protocol and schemas, grid geometry, the `settle` layout engine |
| `apps/realtime`   | Cloudflare Worker + `Box` Durable Object; `Room` holds all box rules |
| `apps/web`        | Solid 2.0 client (Vite), deployed to Vercel                          |
| `e2e`             | Playwright tests with two or three real browsers in one box          |

**Key decisions**

- **Server is authoritative.** Clients send ops; the Durable Object validates, applies and
  broadcasts. Rules live in `Room`, a pure class unit-tested in Node.
- **Shared layout.** The same `settle()` runs on server and client, so drag previews match.
- **Grid units everywhere.** Every viewer sees the same layout and line wraps at any screen size.
- **Permissions are server-side.** Owner token (hashed), roles per device, PBKDF2 passwords.

## Develop

Requires Node 22.12+.

```bash
npm install
```

```bash
npm run dev
```

Web app on `localhost:5173`, realtime server on `localhost:8787`.

```bash
npm run check
```

```bash
npm run e2e
```

## Deploy

**Realtime (Cloudflare):** set `ALLOWED_ORIGINS` under `env.production` in
`apps/realtime/wrangler.jsonc`, then run:

```bash
npm run deploy -w @bentogether/realtime
```

**Web (Vercel):** import the repo, set Root Directory to `apps/web`, and set `VITE_REALTIME_URL`
to the Worker URL.

CI runs checks and e2e on every push. It also deploys the Worker from `main` when
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets are set.
