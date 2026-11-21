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
the x of one widget, the caret of one person, the hue of one cursor.
Solid's fine-grained signals update exactly the DOM node that depends on
each value. A remote cursor moving 20 times a second re-renders one
`transform`, not a component tree. 2.0 adds the missing pieces for the parts
that are async: optimistic writes, actions and boundaries that hold stale
content instead of flashing spinners.

---

## Ledger

Each entry: **where**, **which primitive**, **why**, and any **finding**.

### 1. Server truth and an optimistic overlay are separate stores

- **Where:** `apps/web/src/board/session.ts`
- **Primitives:** `createStore`, `createOptimisticStore`, `action`,
  `createMemo`
- **Shape:**
  - `server`: a plain `createStore`. Only socket messages write to it. It
    is the confirmed state of the box.
  - `overlay`: a non-derived `createOptimisticStore`. One-off local writes
    (move, recolor, text size, currency, title, delete) go here inside an
    `action`, so they show at once. Adding a widget and edits made in bursts
    use a plain `pending` store instead (entries 13 and 14).
  - A widget's view is `overlay.rects[id] ?? server.widgets[id]` (and the
    same for colors, sizes...), minus `overlay.deleted`.
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
  pushes several widgets) lands as one render. No `batch()` needed;
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

- **Where:** `pages/Home.tsx` ("Packing the box…"). The widget picker's
  "Adding…" (`board/AddWidget.tsx`) used this too, until adding left actions
  (entry 14); it's a plain signal now.
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
  (remote cursor easing), `pages/BoxPage.tsx` (document title), `board/widgets/note/Note.tsx`
  (focus, refused typing)
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

### 13. Rapid list edits stay out of actions

- **Where:** `board/session.ts` (`changeItem`, `setListTitle`), `board/widgets/todo/Todo.tsx`
- **Primitives:** plain `createStore` for pending edits; no `action`
- **Shape:** each To-do change is written to a `pending` store, sent, and
  removed when the server answers (or rejects). A list's items are the
  server's list with the pending changes replayed on top through the same
  pure `applyTodoChange` the server runs. Replaying a change the server has
  already applied is a no-op, so nothing shows twice in the gap between the
  server's echo and the pending entry clearing.
- **Finding:** the first version used one `action` per change, like notes.
  Typing three items with Enter in quick succession (real keystrokes, about
  10ms apart) flashed the page-level `<Loading>` fallback for ~20ms, which
  unmounted the board and dropped focus from the "Add an item" field.
  Script-driven submits at the same spacing never reproduced it, which fits
  the runtime folding real input that arrives during an in-flight action
  into one hold (`STACKED_HOLDS`), with the new rows mounting under it.
  Reading the session once (untracked) did not help; leaving actions out
  did. Note text already worked this way for the same reason: input that
  comes in bursts goes straight to the socket.
- **Rule we follow:** use `action` for one-off edits (add, move, recolor).
  Edits people make in bursts (typing, ticking, adding list items) bypass
  actions and keep their own pending state.
- **Budgets:** +/− clicks follow the same rule. A budget change isn't safe
  to replay twice (−20 counted twice is −40), so pending entries are keyed
  by opId and dropped in the same synchronous handler that writes the
  server's `applied` echo (or `rejected`). Both writes land in one microtask
  batch, so no frame shows the change both confirmed and pending. To-do
  changes use the same path.

### 14. A new widget isn't drawn from an action's optimistic write

- **Where:** `board/session.ts` (`add`, `Pending.created`), `board/AddWidget.tsx`
- **Primitives:** plain `createStore`; no `action`, no optimistic store
- **Shape:** a widget you add is written to the `pending` store under
  its opId, sent, and dropped in the same handler that writes the server's
  `applied` echo (the same-tick drop as budgets). Until then the board reads
  it from there.
- **Finding:** adding used an `action` writing the new widget into the
  optimistic overlay. When the action settled, the board's row for it was
  removed and built again about 10ms later (a MutationObserver showed the
  `<article>` go and come back), so anything typed into a just-added list
  before the server answered was lost. Latching the widget's kind did
  not help; drawing the row from plain pending state did. The picker's own
  `action` wrapper went too, for the same reason.
- **Rule we follow:** anything people may start typing into straight away
  is drawn from plain state, never from an action's optimistic layer.

### 15. One change op for the newer widgets

- **Where:** `shared/changes.ts` (`applyWidgetChange`), `session.ts`
  (`change`, `live`), `room.ts` (`case "change"`)
- **Shape:** Timer, Poll, Ideas, Asks, Free times and Calendar share one
  `{type: "change"}` op whose payload is a valibot variant on `kind`, nested
  with a variant on `do`. One pure reducer serves the server and the
  client's replay of its own changes in flight, and `live(id, kind)` returns
  the widget with those applied. Rows inside them (options, ideas,
  people) are keyed by id through `createRows`, like To-do items.
- **Timer:** nothing is sent while it runs. The server stores when it ends;
  each screen ticks a signal every 200ms and reads the time left off the
  server's clock (the welcome carries `now`). An effect writing the current
  time into a signal tripped `EFFECT_RELAY_TEAR`; ticking a counter and
  reading the clock in the derivation did not.

### 16. Typing state lives outside the store

- **Where:** `board/session.ts` (typing), `board/widgets/note/Note.tsx`
- **Primitives:** plain `Map`s mirrored into stores, `<For keyed={false}>`
- **Shape:** each note you're typing in has a plain object holding its
  confirmed text and version, the text you see, the edit in flight and the
  buffer (see `packages/shared/src/text.ts`). Every change is computed
  there first and then copied into the `server` and `drafts` stores, which
  exist only for drawing.
- **Finding:** keeping this state in the store broke merging. Edits chain
  within one task (catching up after a reconnect applies several in a
  row), and in 2.0 a store read right after a write still returns the old
  value until the batch flushes (entry 2). The first version read the text
  it had just written and applied the next edit to stale text.
- **The editor is imperative:** the textarea's value isn't bound. Binding
  it would reset the caret on every remote edit. Instead `watchText` hands
  the open editor each remote edit, which it applies with the caret and
  selection moved along with the text, and holds back during IME
  composition.
- **Keying:** the caret overlay splits the text into pieces that are new
  objects on every keystroke. With the default keying, `<For>` rebuilt every
  row (dev warning `UNSTABLE_LIST_IDENTITY`). `keyed={false}` reuses rows by
  position, and the row has to read `piece()` inside JSX: reading it once
  at the top of the row freezes the row (eslint `solid/reactivity` catches
  this).
- **Finding:** clearing `peers` on reconnect made your own role read as
  "viewer" until the welcome came back, which made the note read-only and
  closed the editor mid-sentence. You now stay in `peers` while the line is
  down.

### 17. Server data is merged leaf by leaf

- **Where:** `board/session.ts` (`mergeInto`): presence, widgets, the
  bento's meta
- **Primitive:** store drafts, assigned per field
- **Finding (dev diagnostics):** `peers[sid].presence = msg.presence`, and
  `Object.assign` of a widget whose nested `view` object arrived fresh,
  triggered `IMMUTABLE_UPDATE_IN_STORE`. A new container makes every reader
  of any part of it re-run. For presence that's 20 times a second per
  person.
- **Shape:** `mergeInto(target, next)` walks plain objects and assigns only
  the leaves that differ. Arrays (list items, events) and nulls are set
  whole, because merging an array by position would keep removed items.
- **Check:** a session test asserts a peer's `cursor` keeps its identity
  across updates, and the e2e suite runs with no warnings.

---

_Next up:_ `createProjection` for filtering widgets by type and value,
`<Reveal>` for loading richer widgets in order, and `affects()` for a
"saving" state on slow writes.
