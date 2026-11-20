# Solid 2.0 in benTogether

A running log of how this app uses Solid 2.0 (`solid-js@2.0.3`,
`@solidjs/web@2.0.3`): which primitives it relies on, why, and what we found
by running them. Update it whenever a feature leans on a Solid 2.0 idea.

The reference used while building is the cheatsheet that ships with the
package (`node_modules/solid-js/CHEATSHEET.md`) plus small runtime probes.
When the docs and a probe disagree, the probe wins and gets written down
here.

---

## Why Solid 2.0 for a multiplayer board

A live board is a large graph of small values that change independently:
the x of one compartment, the caret of one person, the hue of one cursor.
Solid's fine-grained signals update exactly the DOM node that depends on
each value. A remote cursor moving 20 times a second re-renders one
`transform`, not a component tree. 2.0 adds the missing pieces for the parts
that are async: optimistic writes, actions and boundaries that hold stale
content instead of flashing spinners.

---

## Ledger

Each entry: **where**, **which primitive**, **why**, and any **finding**.

### 1. Server truth and an optimistic overlay are separate stores

- **Where:** `apps/web/src/board/state.ts`
- **Primitives:** `createStore`, `createOptimisticStore`, `action`,
  `createMemo`
- **Shape:**
  - `server`: a plain `createStore`. Only socket messages write to it. It
    is the confirmed state of the box.
  - `overlay`: a non-derived `createOptimisticStore`. Local writes (add,
    move, recolor, delete) go here inside an `action`, so they show at once.
  - A compartment's view is `overlay.items[id] ?? server.items[id]` (minus
    `overlay.deleted`).
  - The action yields until the server acknowledges the op. When the
    transition settles, the overlay reverts on its own and the confirmed
    value in `server` shows through. If the server rejects the op, the
    action throws and the optimistic write rolls back with no rollback code.
- **Finding (probe `t2`):** our first attempt derived the optimistic store
  from the server store:
  `createOptimisticStore(() => ({ items: { ...server.items } }))`. While an
  action was in flight, writes to `server` from other people were **held**
  until the action settled, because the store was entangled with the
  transition. On a multiplayer board that means everyone else freezes for
  one round trip whenever you add a note. A separate store that the
  transition never reads is not held (probe `t3`, case 1). Probe `t4`
  confirmed the split design: remote edits stay live during your action,
  the server echo shows through after acknowledgement, and a rejected delete
  rolls back.
- **Rule we follow:** state that other people write must never be read by
  a computation that a local transition owns. Optimism goes in a separate
  store, and the two are merged in a memo.

### 2. Writes are batched per microtask

- **Where:** socket message handling (`board/session.ts`)
- **Primitive:** default microtask batching and `flush()`
- **Why:** a burst of messages in one task (a peer joining, a move that
  pushes several compartments) lands as one render. No `batch()` needed;
  it no longer exists.
- **Tests:** tests wait a tick (or call `flush()`) before asserting, because
  reads lag writes in 2.0.

### 3. Opening a box is an async memo under `<Loading>` and `<Errored>`

- **Where:** `pages/BoxPage.tsx`, `board/session.ts`
- **Primitives:** async `createMemo`, `<Loading>`, `<Errored>`, `onCleanup`
- **Shape:** `createMemo(() => openSession(props.id, identity))` returns a
  Promise that resolves on the server's first `welcome`. `<Loading>` shows
  a rotating loading line until then; a missing box rejects the Promise and
  `<Errored>` shows "Nothing in this box." There are no `loading`/`error`
  branches anywhere in the components. The join modal reads the box title
  the same way (`createMemo(() => getBox(props.id))`).
- **Lifecycle:** `onCleanup` inside the memo closes the socket, so changing
  the id or leaving the page tears the connection down with no extra code.
- **Finding:** the socket originally reported `"connecting"` synchronously
  from its constructor. That's a store write inside the memo's compute,
  which 2.0 forbids (writes inside an owned scope throw in dev). Status now
  only changes from socket events and timers.

### 4. Optimistic process flags with `createOptimistic`

- **Where:** `board/Toolbar.tsx` ("Adding…"), `pages/Home.tsx` ("Packing
  the box…")
- **Primitives:** `createOptimistic(false)` written inside an `action`
- **Why:** the flag is true for exactly as long as the action is in flight
  and reverts by itself, including on failure. This is the documented 2.0
  pattern for "saving…" affordances (`isPending` is for value changes, not
  processes).

### 5. Writable derived signal for the per-box name

- **Where:** `pages/BoxPage.tsx`
- **Primitive:** `createSignal(() => nameFor(props.id))`
- **Why:** the name is seeded from storage for this box, resets when the
  box id changes, and is set locally when you join or rename. One signal,
  no effect syncing it to the prop.

### 6. Split effects keep side effects out of tracking

- **Where:** `cursors/CursorTag.tsx` (typewriter), `cursors/Cursors.tsx`
  (remote cursor easing), `pages/BoxPage.tsx` (document title), `board/Note.tsx`
  (focus, lease loss)
- **Primitive:** `createEffect(compute, apply)`
- **Shape:** compute reads reactive values and returns plain data; apply
  does the DOM work and returns its cleanup (the typewriter's timer is
  cleared before the next goal starts typing).
- **Finding (dev diagnostics):** the first document-title effect read
  `meta.title` from the store inside apply. Solid's dev build reported
  `STRICT_READ_UNTRACKED` with the exact property, and the fix was to
  extract `{ id, title }` in compute. The same rule shaped the typewriter,
  which mirrors the typed text in a plain variable rather than reading its
  own signal in apply.

### 7. Fine-grained updates where it matters

- **Where:** `cursors/Cursors.tsx`, `board/Board.tsx`
- **Why:** a remote cursor updates about 20 times a second. Its effect only
  sets a target; a `requestAnimationFrame` loop eases toward it and writes
  `transform` directly. Nothing re-renders. Each note's rect is its own memo
  with a structural `equals`, so a drag that moves one note doesn't touch the
  others.
- **Your own cursor** skips the graph entirely: it's a CSS cursor (hardware
  drawn, zero lag), and the "you" pill's transform is written straight from
  `pointermove`. Going through a signal and effect for the pointer added a
  visible frame of lag. Not everything should be reactive.

### 8. Control flow follows 2.0 keying rules

- `<For each={peers} keyed={(p) => p.sid}>` gives the callback an
  **accessor** (`peer()`), so a peer's presence updates in place instead of
  re-creating their cursor.
- `<Show when={x()}>{(v) => …}` children receive accessors too, and are read
  in JSX, not at the top of the callback.
- Lists of static data still use `<For>`: `eslint-plugin-solid` (v2 config)
  flags `Array#map` in JSX.

### 9. Boolean attributes are presence or absence, `data-*` included

- **Finding:** `data-visible={true}` renders `data-visible=""`, and `false`
  removes the attribute. Every `[data-x="true"]` selector we wrote silently
  matched nothing, which is why remote cursors were first invisible. All
  boolean state selectors use the presence form (`[data-visible]`).

### 10. A live list with a quiet `refresh()` (removed)

- Public bentos had a list and gallery that refreshed every 20s with a bare
  `refresh(memo)`: the list updated in place with no skeleton flash and no
  pending state. The feature was removed (sharing is link-based now), but the
  pattern stands for any polled list.

### 11. A prop expression is a getter, and getters re-run

- **Finding:** `<NameField defaultName={suggestName()} />` compiles to a
  getter, so the child re-evaluates it whenever its binding re-runs. Opening
  the color popover re-ran the input's grouped attribute effect, which
  called `suggestName()` again and swapped the suggested name mid-form.
- **Fix:** call side-effectful or random helpers once in the component body
  (`const suggested = suggestName()`) and pass the value. Props should be
  pure reads.

### 12. `<Errored>` with `reset` as a retry path

- **Where:** `pages/BoxPage.tsx` (password protected bentos)
- **Primitives:** `<Errored fallback={(err, reset) => …}>`, writable derived
  `createSignal(() => passwordFor(props.id))`
- **Shape:** a wrong or missing password closes the socket with code 4401,
  which rejects the session memo with `PasswordRequired`. The `<Errored>`
  fallback branches on the error type: for a password it renders the join
  form with the message; submitting stores the password and calls `reset()`,
  which re-runs the branch with a new session. No retry state machine.
- The Share dialog's general-access select is also a writable derived
  signal (`createSignal(() => s().access().mode)`): it follows the server,
  but the owner can flip it to "Password protected" locally while they type
  a password, before anything is saved.

---

_Next up:_ `createProjection` for filtering compartments by type and value,
`<Reveal>` for loading richer compartments in order, and `affects()` for a
"saving" state on slow writes.
