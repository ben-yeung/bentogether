# Technical review: Solid 2.0 signals and Cloudflare Durable Objects

_2026-11-20 · reviewed at `41369f6` (main) · read-only review, nothing changed in code_

Scope: how benTogether uses Solid 2.0's reactive primitives on the client
(`apps/web`) and Cloudflare Durable Objects on the server (`apps/realtime`),
plus the seam between them (`packages/shared`, the socket protocol).

---

## Status after the follow-ups (same day)

| #   | Outcome                                                                                                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Fixed.** Leases survive hibernation, idle takeover after 30 s, and unsent words are kept (see "Editing the same widget") |
| 2   | **Fixed.** Confirmed changes are written in the same event (`Box.save`); only note text is coalesced                       |
| 3   | **Fixed.** `Socket.retire()` detaches and closes the old connection; every handler checks it's current                     |
| 4   | **Fixed.** Presence pauses while the tab is hidden or unfocused, and an unchanged presence isn't re-sent                   |
| 7   | **Fixed.** Comes with 2: `now`, `soon` and `removed` now mean what their comments say                                      |
| 9   | **Fixed.** Hardened for hostile clients (see its section, which also corrects my first claim)                              |
| 10  | **Fixed.** `SOLID-2.md` paths and entries 1 and 4, and the README's architecture notes                                     |
| 5   | **Fixed (branch `claude/review-leftovers`).** Socket ids are cached in a `WeakMap`; `dispatch` reads each once per batch   |
| 6   | **Fixed (same branch).** `rev` removed from the protocol; note text has its own persisted version (`tv`)                   |
| 8   | **Fixed (same branch).** A hello on another version closes with `CLOSE.outdated`; the tab offers Reload                    |

Verified with `npm run check` (118 unit tests) and the full Playwright suite
(26 passed), run against this branch's own servers on ports 5174 and 8788.
New unit tests cover the socket replacement, presence gating and skipping,
a list title being saved before it's confirmed, idle takeover, leases
restored after a wake, and a refused keystroke releasing the note. A new e2e
test waits out the real 30 s and holds back Alice's last words with
Playwright's WebSocket routing. It passes through a real hibernation and
wake under `wrangler dev`. The `Box` changes (2, 9) still have no direct
test, because there's no Workers test harness yet.

**Fixed on `claude/review-leftovers`:** store objects (presence, widgets,
the bento's meta) are now merged field by field, and the e2e suite runs
with no `IMMUTABLE_UPDATE_IN_STORE` warnings. The original note follows.

**New, seen during the e2e run:** Solid's dev build warns
`IMMUTABLE_UPDATE_IN_STORE` for `peers[sid].presence = msg.presence`
(`session.ts`, `case "presence"`). Replacing the whole object makes every
reader of `presence` re-run, not only readers of the field that changed.
Assigning leaf by leaf (or using `reconcile`) fixes it. This is 20 Hz data,
so it's worth doing.

---

## TL;DR

The architecture is sound and unusually well-reasoned. The server is
authoritative, the rules sit in a pure `Room` class with good unit tests,
the Durable Object is a thin I/O shell around it, and the client keeps
server truth apart from local optimism. `docs/SOLID-2.md` is a strong
record of why things are the way they are, and the hard-won rules in it
(keep optimism out of stores other people write; no actions for burst edits)
are correct.

What needs work is mostly at the **hibernation boundary**. Some state lives
only in DO memory (leases, the dirty-write set, `rev`, rate limits). When
the object is evicted, that state is lost and the client isn't told.

| #   | Severity | Finding                                                                           |
| --- | -------- | --------------------------------------------------------------------------------- |
| 1   | **High** | Note leases are lost on hibernation, so text typed afterwards is silently dropped |
| 2   | Medium   | Unflushed edits (up to ~1.5 s, more under load) are lost on eviction or deploy    |
| 3   | Medium   | `Socket.onOnline` can open a second socket while one is still connecting          |
| 4   | Medium   | Presence dominates DO cost; worth measuring against the free-tier quota           |
| 5   | Low      | `dispatch` deserializes every attachment on every message (O(peers²) at 20 Hz)    |
| 6   | Low      | `rev` is never read on the client and resets to 0 on wake                         |
| 7   | Low      | `Persist.now` and `Persist.soon` are handled the same; the comments say otherwise |
| 8   | Low      | A protocol version bump shows old tabs "unreachable", not "reload"                |
| 9   | Low      | `hello` awaits hashing, so its checks race with each other (TOCTOU)               |
| 10  | Docs     | `SOLID-2.md` points at files that moved (`board/state.ts`, `board/Note.tsx`, ...) |

---

## Editing the same widget (question on finding 1)

> **Superseded (2026-11-21):** leases and idle takeover were replaced by
> simultaneous typing (operational transform) on branch `claude/note-ot`.
> Anyone can type in a note at once; see the README's key decisions and
> `packages/shared/src/text.ts`. The section below records the lease design
> as it was.

**How it works today**

- **Notes have one writer at a time (a lease).** Clicking into a note takes
  its lease, and everyone else watches the text and caret stream in. If
  someone else clicks in, they get "Alice is typing here." and stay
  read-only. The lease ends when Alice's textarea loses focus (clicking
  away, Escape, switching windows), when she disconnects, when she's made a
  viewer, or when the note is deleted. Deleting someone else's note while
  they're in it is refused.
- **Every other widget has no lease.** Edits are small ops that the server
  merges: two people can tick and add items in one to-do at once, budget
  +/− clicks add up, and votes are per person. Two edits to the same thing
  (one item's text, a title) go to whichever arrives last.

**When the first person sits in a note**

- If Alice stays focused in a note and walks away, Bob is locked out for as
  long as she stays there.
- With the hibernation bug it's worse. About 10 s after the box goes quiet,
  the server forgets Alice's lease, so Bob can take the note. Alice's screen
  still says she holds it, and what she types next is dropped without any
  sign. Each of them thinks they're the one typing.

**What was built** (the proposal, as shipped)

1. Make leases survive hibernation by storing them in the holder's socket
   attachment, together with when the holder was last active. Keeping the
   time turned out to matter. The e2e test first failed because a quiet box
   hibernates after about 10 s, and a lease restored with its clock started
   at wake was never idle when Bob's click woke the box. The time is
   updated in memory only (`serializeAttachment`), so it costs no writes.
2. **Idle takeover, checked only when someone asks.** The server records
   when the holder last sent text or moved their caret. If Bob asks for a
   note whose holder has been idle more than about 30 s, he gets it, and
   `lease → Bob` goes out. Alice's existing "lease lost" effect ends her
   edit. Nobody is ever cut off while typing, and there are no timers to
   wake the object. (`LEASE_IDLE_MS` in `room.ts`; the client always asks
   the server now instead of refusing on its own.)
3. On the client, a `leased` rejection of typed text counts as losing the
   lease (`textOps` in `session.ts`). So does a reconnect, which used to
   leave the editor open on a note the server had released. Edit mode ends.
   Everything the bento confirmed is already saved. Anything past that is
   kept on the note in a "Not saved: your last words" panel with Copy and
   Dismiss, and a toast says who took over. The panel hides itself if a
   reconnect shows the text did save.

The alternative is an explicit "Take over" button that appears for others
once the holder has been idle for a while. It's friendlier when two people
are talking it through, but it adds a UI.

---

## 1. Durable Objects: how they're used

### Topology

```
Browser ──wss──▶ Worker (index.ts)  ──getByName(id)──▶  Box DO (box.ts)  ──▶  Room (room.ts, pure)
                 CORS / origin check                    SQLite storage
                 rate limits (CF ratelimits)            hibernating sockets
                 RPC: init(), meta()                    alarm-driven flush
```

- **One DO per box**, addressed by name (`env.BOX.getByName(boxId)`). This
  is the textbook fit: a box is a natural unit of consistency, and all
  writes for it go through one single-threaded actor.
- **RPC for control, `fetch` for sockets.** `init()` and `meta()` are typed
  RPC methods. Only the WebSocket upgrade goes through `fetch`. This is the
  modern style and is clean.
- **SQLite-backed storage** (`new_sqlite_classes`): two tables, `meta`
  (key/value JSON) and `widgets` (one JSON row per widget). It's a simple
  document layout and fits 300 widgets per box well.
- **The existence check before migrating** (`exists()` in the constructor)
  means a lookup of a random id leaves no storage behind. A nice touch.
- **Migrations** in `wrangler.jsonc` handle `Directory` going away
  properly (`deleted_classes`).

### Hibernation API

- `ctx.acceptWebSocket(server, [ip])` uses IP **tags**, so the per-IP socket
  cap is `getWebSockets(ip)`, with no in-memory map needed. Good.
- `serializeAttachment({ sid, peer, at })` keeps identity and role across
  eviction. The constructor rebuilds `Room.peers` from attachments inside
  `blockConcurrencyWhile`. Correct.
- `setWebSocketAutoResponse('{"t":"ping"}' → '{"t":"pong"}')` answers
  keep-alives without waking the object. The client sends exactly
  `JSON.stringify({t:"ping"})`, which matches byte for byte. This only works
  while the key order and whitespace never change; a comment at the client's
  ping site saying so would help.
- **Accept the socket, then close it with a code** (in both the Worker's
  `refuseSocket` and `Box.fetch`), so the browser gets a readable close code
  instead of an opaque 1006. A good pattern.

### Write coalescing

`Room.apply` returns a `Persist` set. `Box.save` marks those ids dirty and
schedules an alarm `FLUSH_MS` (1.5 s) later. `flush` writes up to a token
budget (5 rows/s, burst 600), or everything once the box has been idle for
2 s or the last peer leaves. A drag that sends 40 moves becomes one row
write. This is a deliberate trade for the free plan's daily rows-written
quota, and it's a reasonable one. See finding 2 for what it costs.

### Abuse limits

These are layered well:

- **Worker**: per-IP limits on create, connect and meta lookups.
- **Per socket**: separate token buckets for all messages, ops and settings,
  with a refilling "strikes" bucket that closes persistent offenders.
- **Per box**: socket cap, peer cap, sockets per IP (IPv6 cut to /64), a
  hello timeout, and a box-wide password-guess bucket.
- **Message size**: checked before `JSON.parse`.
- **Over-quota errors** become a 503 or a 4503 close that the client
  explains, plus `/__dev` switches to simulate them. That's thorough.

---

## 2. Solid 2.0: how it's used

### State model (`board/session.ts`)

There are three layers, merged at read time by plain accessor functions:

| Layer     | Primitive               | Written by                     | Used for                                                                   |
| --------- | ----------------------- | ------------------------------ | -------------------------------------------------------------------------- |
| `server`  | `createStore`           | socket messages only           | confirmed truth                                                            |
| `overlay` | `createOptimisticStore` | inside `action`s only          | one-off edits: move, recolor, resize text, delete, currency, title         |
| `pending` | `createStore`           | plain functions, keyed by opId | burst edits: list items, budgets, widget changes, new widgets, list titles |

Plus `peers` and `leases` stores, and **non-reactive** state for anything
hot: presence coalescing, the text-typing timers, and the in-flight op map.

**What's good**

- **Optimism is kept out of stores other people write** (ledger #1). This
  is the most important Solid 2.0 decision in the app, and it's right: an
  optimistic store derived from `server` would freeze every remote edit
  for one round trip.
- **Ordering in the `applied` handler is correct.** The server write lands
  before `dropPending`/`settleOp` in the same synchronous handler, so the
  overlay or pending entry reverts in the same microtask batch the
  confirmed value arrives in. No flicker frame. Ledger #13 calls this out.
- **One reducer for the server and the client's replay** (`applyTodoChange`,
  `applyBudgetChange`, `applyWidgetChange` in `packages/shared`), so pending
  replays can't drift from server semantics.
- **Widgets memoize the replay** (`Todo.tsx:28`, `Budget.tsx:26`,
  `Poll.tsx:26`, `Timer.tsx:20`), so `items()`/`budget()`/`live()` being
  plain functions doesn't cost anything per read.
- **An async `createMemo` + `<Loading>` + `<Errored reset>`** for opening
  a box (`BoxPage.tsx`). Opening, password retry and name clashes all go
  through one `reset()` path with no hand-built state machine. The memo's
  `onCleanup` closes the socket. Idiomatic 2.0.
- **Split effects** (`createEffect(compute, apply)`) are used consistently,
  and the `STRICT_READ_UNTRACKED` lesson is applied (`BoxPage.tsx:144`).
- **Writable derived signals** (`createSignal(() => nameFor(props.id))`)
  replace prop-to-signal sync effects.
- **Knowing when not to be reactive**: cursor easing is a rAF loop, and the
  local cursor and "you" pill skip the graph. Correct for 20 Hz data.
- **`Socket` has no Solid imports** and never writes status synchronously,
  which keeps 2.0's no-writes-in-owned-scope rule.

**Watch items**

- **Two optimism mechanisms.** `action` + overlay and plain `pending` both
  exist, and the line between them is "is this edit bursty?". That's the
  right call given what you found (`STACKED_HOLDS`, rows rebuilt when an
  action settles). But it's an easy rule to break. Each new widget op has
  to pick a side, and the wrong choice shows up only with real keystrokes.
  Two ways to make it hold:
  - (a) Move everything to `pending`, keep actions only for owner settings
    where `<Loading>`-style holds are fine, and drop `createOptimisticStore`.
  - (b) Keep both, and add an e2e test that types quickly into a freshly
    added widget of each kind.

  I lean (a): the pending path is already the general one (it handles
  replay, ordering and same-tick drop), and actions now buy little beyond
  automatic revert.

- **Overlay hides remote changes for one round trip.** `rect()` returns
  `overlay.rects[id]` before `server`. During your `move`, a relayout
  pushed by someone else's edit won't show for the moved set until your
  action settles. That's one RTT, so it's acceptable. Just know it's there.
- **`base(id)` scans `pending.created`** with `Object.values(...).find`. It
  runs inside the `ids` sort comparator, so the cost is
  O(n log n × pending). That's fine at today's sizes. Key `created` by
  widget id if it ever shows up in a profile.
- **Next on the ledger** (`createProjection`, `<Reveal>`, `affects()`):
  `affects()` for "saving…" on slow writes fits directly over the
  `pending` store, so it's a good next step.

---

## 3. Findings in detail

### 1. Leases are lost on hibernation, and typed text is dropped silently · High

**Where:** `apps/realtime/src/box.ts:41` (`Attachment`), `box.ts:75-79`
(restore), `room.ts:375`, `apps/web/src/board/session.ts:691` (`typeText`),
`session.ts:284` (`rejected`).

`Room.leases` is in memory only. The constructor restores peers from
socket attachments but not leases. Here's how it plays out:

1. Alice focuses a note, so she holds its lease, and pauses for more than
   ~10 s. Pings are auto-answered and don't wake the object, and a still
   cursor sends no presence. The DO is evicted.
2. Alice types. The DO wakes with `leases` empty. Her `patch` hits
   `holder !== sid` and is rejected with `leased`.
3. `typeText` sends with a throwaway opId that isn't in `inflight`, so
   `settleOp` ignores the rejection. Her client still has
   `leases[id] === mySid`, so the Note stays in edit mode.
4. **What Alice types is never saved or broadcast, and nothing on screen
   tells her.** Others see the note frozen.

**Fix options** (cheapest first):

- Persist leases in the holder's attachment
  (`{ sid, peer, leases: string[] }`) and restore them in the constructor.
  `Room.lease` already returns everything needed to update it.
- Or have the client treat a `leased` rejection of a text patch as lease
  loss: try to re-take the lease, and exit edit mode if that fails. Keep the
  draft so nothing is lost.
- Ideally do both. _(Done: both, plus idle takeover; see "Editing the
  same widget".)_ Add a `Box`-level test (Miniflare/`vitest-pool-workers`)
  that evicts the object between take and patch. Today only `Room` is
  tested.

### 2. Durability window for unflushed edits · Medium

**Where:** `box.ts:529-554`, `limits.ts:69-74`.

`dirty` is an in-memory `Set`. Edits are broadcast at once but written
later, so for up to `FLUSH_MS` (1.5 s) everyone has seen a change that
isn't saved. Under sustained edits, rows past the write budget wait longer.
In normal hibernation this is fine, because the 1.5 s alarm fires well
before the ~10 s eviction. But **deploys, runtime restarts and DO
migrations evict at once**, and whatever is in `dirty` is gone. Every
client then reconnects and gets a `welcome` without those edits.

Also, `Persist.now` ("structural change: save now") is handled exactly like
`soon` (finding 7). The comment suggests creates, deletes and moves were
meant to be written right away.

**Options:**

- Write `persist.now` and `persist.removed` right away (in the same
  handler) and defer only `soon` (typing). Creates and deletes are rare, so
  the row cost is small, and losing a create the user saw confirmed is the
  worst case here.
- Optionally hold the `applied` broadcast until the write lands. DO output
  gates already do this for storage writes in the same event, so writing
  inline gives you "confirmed means saved" for free.

### 3. `Socket.onOnline` can open a second socket · Medium

**Where:** `apps/web/src/lib/socket.ts:107-112`.

`onOnline` checks `isOpen` (`readyState === OPEN`) and calls `connect()`.
If the current socket is still **CONNECTING** when `online` fires (common
when a laptop wakes), a second socket is created. The first one's handlers
are still attached:

- its `onopen` sends `hello` (now a second peer for the same client), and
- its `onmessage` still feeds `onMessage`, including a second `welcome`.

Only `onclose` checks `this.ws !== ws`. **Fix:** in `connect()`, detach and
close the previous socket first, and gate `onopen` and `onmessage` on
`this.ws === ws`. Also skip `onOnline` when `readyState === CONNECTING`.

### 4. Presence is the main cost driver · Medium (to measure)

At 20 Hz, one person moving their cursor sends 20 incoming messages per
second. Cloudflare bills incoming WebSocket messages to a DO as requests,
at 20 messages per request (outgoing messages are free). That's about one
billed request per second per active cursor. Presence also keeps the object
awake, which adds duration (GB-s). Check these ratios and the free-tier
limits against current Cloudflare pricing. With 100k requests/day, a handful
of active users for a few hours a day would use up a large share of the
quota.

Ideas, if measurements confirm it:

- Send presence at 10–12 Hz. The rAF easing in `Cursors.tsx` already hides
  the gap.
- Stop sending when the pointer leaves the board or the tab is hidden
  (`visibilitychange`).
- Skip sends when the cursor moved less than about a grid cell / 4.

### 5. `dispatch` deserializes every attachment on every message · Low

**Where:** `box.ts:411-433`.

Each `dispatch` calls `getWebSockets()` and `deserializeAttachment()` for
every socket. With 32 peers at 20 Hz, that's about 640 dispatches/s × 32,
roughly 20k deserializations/s, mostly for presence. Cache `sid` (and
`hasPeer`) in a `WeakMap<WebSocket, string>`. Fill it when the socket is
accepted and in the constructor's restore loop, so it survives eviction.
Also check `this.room.peers.has(sid)` once per socket, not once per message.

### 6. `rev` is never used · Low

`Room.rev` counts up per op but starts from 0 every time the object
rebuilds. The client stores `server.rev` (`session.ts:251,271`) and never
reads it. WebSockets are ordered and every reconnect gets a full `welcome`,
so nothing needs gap detection today. Either remove it, or, if you plan
deltas or resync, persist it in `meta` first. Otherwise the first feature
that relies on it will break after the first eviction.

### 7. The `Persist.now` / `soon` comments are wrong · Low

The comments at `room.ts:39-45` describe two policies, but `Box.save`
merges all three sets into `dirty`. Either do finding 2's fix or collapse
the type to a single set so the comments stop misleading readers.

### 8. Protocol version mismatch looks like "unreachable" · Low

`hello.v` is `v.literal(PROTOCOL_VERSION)`. A stale tab after a bump sends
`v: 1`, gets `bad_message` plus a strike, and stays open without a peer. It
sits until the hello sweep or the client's 15 s connect timeout, and then
shows **Unreachable**. A dedicated close code (`CLOSE.outdated`) sent when
a hello fails only on `v` would let the client say "benTogether updated:
reload".

### 9. `hello` checks race with each other · Low → **fixed, hardened for hostile clients**

The `hello` case awaits `sha256` and `pbkdf2`. Those aren't storage calls,
so input gates don't hold other events while they run.

_Correction:_ the first version of this review said two people with the
same name could both get in. They can't: `nameTaken` already ran after both
awaits, right before `room.join`. Looking at the path again with a hostile
client in mind turned up these real gaps instead:

- **A second `hello` during the first's checks** passed `if (a.peer)` and
  joined the same socket twice.
- **A ghost peer.** A client sends a password `hello` and closes at once.
  The close handler runs during the hash, finds no peer and does nothing,
  and then the `hello` joins a peer that no close event will ever remove.
  Repeat that and the bento fills with ghost peers (a cheap lockout).
- **The peer cap was only checked when a socket was accepted.**
  `MAX_SOCKETS` (40) is higher than `MAX_PEERS` (32), so sockets accepted
  together could all join.
- **One address could lock everyone out of the password form** by using up
  the bento-wide 20-tries-a-minute budget.

**What changed** (`Box.hello` in `box.ts`):

- A `joining` WeakSet. Any second `hello` on a socket, during or after the
  first, closes it with `badHello`.
- After the awaits, the socket must still be `OPEN`, there must be a free
  seat (`MAX_PEERS`), and the name must be free. Only then does it join.
- A per-address password budget (5 a minute, spent first), alongside the
  unchanged bento-wide one (20 a minute). One address now gets only its own
  share of the bento-wide budget. The per-address map is capped at 1,024
  entries.
- Not covered: many addresses guessing together can still use up the
  bento-wide budget. That's what it's for, since it caps brute-force guesses.

### 10. `SOLID-2.md` points at moved files · Docs

- Ledger #1 says `apps/web/src/board/state.ts`. It's `board/session.ts`.
- Ledger #6 and #13 say `board/Note.tsx` and `board/Todo.tsx`. They're now
  `board/widgets/note/Note.tsx` and `board/widgets/todo/Todo.tsx`.
- README's diagram says "optimistic overlay (actions)". Worth adding the
  `pending` layer, since it now carries most edits.

---

## 4. Smaller notes

- `Room.roles` (by clientId) only grows. Every device the owner ever gave a
  role stays in `meta.roles`. Fine at this scale; consider a cap.
- `case "role"` calls `saveRoles()` even when the owner check rejected the
  change. That's one wasted row write per denied attempt (rate-limited, so
  minor).
- `webSocketClose` closes the socket back. On recent compatibility dates the
  runtime may already auto-reply to close frames
  (`web_socket_auto_reply_to_close`). The try/catch makes it harmless
  either way; check the flag for compatibility date `2026-11-01` and drop it
  if it's on.
- Home's `meta()` lookups (up to 24 at a time) each wake a DO and count as
  a request. If the free-tier quota gets tight, put cached summaries in KV
  or local storage with a TTL.
- `welcome` sends the whole box (up to 300 widgets) on every reconnect.
  That's fine against WebSocket message limits. Just keep `MAX_WIDGETS` and
  per-widget content caps in step.
- `sendOp` and `request` in `session.ts` are the same function apart from
  the message they build. One helper would do.

---

## 5. Test coverage at the seams

| Layer           | Covered by                                    | Gap                                                                |
| --------------- | --------------------------------------------- | ------------------------------------------------------------------ |
| `Room` rules    | `room.test.ts` (775 lines, every widget kind) | none notable                                                       |
| `Box` I/O shell | nothing                                       | hibernation restore, flush and alarm, limits, `dispatch` targeting |
| Shared reducers | `changes`, `todo`, `layout`, `identity` tests | fine                                                               |
| Client session  | `session.test.ts` (fake socket)               | reconnect, `onOnline`, typed-text rejection                        |
| End to end      | Playwright, multi-browser                     | idle more than 10 s then type (finding 1)                          |

The most valuable addition is a `Box` test harness
(`@cloudflare/vitest-pool-workers`). It lets you evict the object
(`runInDurableObject` / abort) and check findings 1, 2 and 5 directly.

---

## 6. Suggested order

1. **Finding 1** (lease persistence and client handling of lease loss). It
   loses user data silently.
2. **Finding 3** (socket double-connect). A small, contained fix.
3. **Finding 2** (write structural changes right away).
4. Add a `Box` test harness, then do findings 5 and 9 with tests behind them.
5. Measure presence cost (finding 4) before changing the rate.
6. Docs cleanup (findings 7 and 10).
