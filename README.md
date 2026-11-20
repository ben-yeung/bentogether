# benTogether

**Pack ideas into a bento together.** Share the link,
and everyone at the table sees each note move and each word appear as it happens, with a cursor
in each person's own color.

A portfolio piece for [Solid 2.0](https://www.solidjs.com/), built the way a production app would
be: typed protocol, an authoritative server, tests at each layer, and CI.

- **Brand guide:** [docs/BRAND.md](docs/BRAND.md)
- **How Solid 2.0 is used (running log):** [docs/SOLID-2.md](docs/SOLID-2.md)

## What it does

- Create a box from the opening modal: name it, pick your name for this box and your color, and set
  options (live cursors, auto-pack, starter notes). The right column lists your recent bentos,
  with live counts and created dates. By default notes snap to any cell and stay there;
  auto-pack makes them float up to fill gaps.
- Share it from **Share**: copy the link, set who can edit or only view, what new visitors get, and
  whether it needs a password. A bento is as public as its link: "Anyone with the link" plus
  "Can edit" means anyone who has it can contribute. Guests pick a name (per bento, temporary,
  not unique) and join.
- Add widgets from the floating **+** (sticky notes today), and change the bento's settings (live
  cursors, auto-pack) from the settings icon. Only the creator can change settings.
- Add, drag, resize, recolor and delete notes, and set each note's text size (S, M, L, XL). While someone carries a note, everyone else's box
  makes room for it live, before anything is committed.
- Type in a note while others watch the words stream in, with your caret and name in your color.
  One person types in a note at a time.
- Everyone's cursor shows with a `name · action` pill (`typing`, `moving`, `resizing`).

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

### Decisions worth knowing

- **The server is authoritative.** Clients send ops (`create`, `move`, `patch`, `delete`); the
  Durable Object validates them, applies them, re-packs the layout and broadcasts the result.
  Rules live in `Room`, a pure class with no I/O, so they're unit-tested in plain Node.
- **Layout is a pure, shared function.** `settle()` runs on the server to commit and on every
  client to preview drags. Same input, same layout, so previews match the result.
- **Text uses a lease, not a CRDT.** One person types in a note at a time and everyone else
  watches live. Simpler and predictable for short notes. Concurrent editing of one note would be
  the case for Yjs.
- **Viewport independence.** Positions, sizes and cursors are in grid units (12 columns).
  Everything inside the box (gutters, note padding, note text) is proportional to the cell size,
  so a 2K viewer and a 4K viewer see the same picture at their own scale, with the same line wraps
  and carets on the same words. An e2e test checks this across a 1600px and a 3200px window.
- **Your cursor is a real CSS cursor.** It's an SVG in your color, drawn by the OS with zero
  lag; only the "you" pill is a DOM element. Other people's cursors ease toward each 20 Hz
  update with a ~35ms time constant.
- **Fluid UI type.** Chrome outside the box scales with the root font size: about 17px at 1080p,
  20px at 2K and 26px at 4K at 100% scaling.
- **Ownership without accounts.** Creating a bento returns a random owner token, once. The
  creator's browser keeps it; the Durable Object stores only its SHA-256 hash and checks it
  (constant-time) when that browser connects. Only a verified connection is the owner, so only it
  can rename the bento, and its name and color show as "by [name]" next to the title. The token
  is never relayed to other people.
- **Sharing and permissions are enforced by the server.** Share (Drive-style) sets each person's
  role (Can edit / Can view), the default for new visitors, listing, and general access: anyone
  with the link, or password protected. Viewers keep their cursor but every edit, and every
  attempt to type in a note, is rejected server-side. Roles are remembered per device, and device
  ids are never sent to other people, so nobody can borrow someone else's. Passwords are hashed
  with PBKDF2 (100k iterations, random salt), checked in constant time, and guessing is rate
  limited per bento. The creator's owner token skips the password. There is no public directory:
  public listing was tried and removed in favor of link-based sharing.
- **Cost control.** Cursors are throttled to 20 Hz and only sent on change; text is coalesced to
  one message per 80ms and saved to SQLite at most every 1.5s; sockets hibernate when idle; each
  connection is rate limited (token bucket); box creation is rate limited per IP.

## Develop

Requires Node 22.12+.

```bash
npm install
```

```bash
npm run dev
```

That runs the Worker on `localhost:8787` (`wrangler dev`, local Durable Objects and SQLite) and the
web app on `localhost:5173`.

```bash
npm run check
```

That runs format check, lint (including `eslint-plugin-solid` v2 rules), typecheck and unit tests.

```bash
npm run e2e
```

That runs the Playwright multiplayer tests (starts both servers if they're not running).

## Deploy

**Realtime (Cloudflare):** set `ALLOWED_ORIGINS` in `apps/realtime/wrangler.jsonc` → `env.production`
to your Vercel domains, then:

```bash
npm run deploy -w @bentogether/realtime
```

CI deploys it on every push to `main` once checks and e2e pass (needs `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` secrets on a `production` environment).

**Web (Vercel):** import the repo, set **Root Directory** to `apps/web`, and set
`VITE_REALTIME_URL` to the Worker URL (for example `https://bentogether-realtime.<you>.workers.dev`).
`apps/web/vercel.json` handles install from the monorepo root, SPA rewrites, caching and security
headers. Preview deployments work if their domain matches the `*.vercel.app` pattern in
`ALLOWED_ORIGINS`.

## Known limits and next steps

- Phones get a horizontally scrolling box (min 900px wide); a dedicated small-screen layout is
  future work.
- Cursors below your scrolled view aren't indicated yet (edge markers would help on tall boxes).
- Next: richer compartments in the + picker (image, checklist, link, poll), and filtering
  compartments by type and value (planned with `createProjection`).
