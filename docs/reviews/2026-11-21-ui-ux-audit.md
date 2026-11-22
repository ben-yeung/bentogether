# UI/UX audit: splash to board, every widget

_2026-11-21 · reviewed at `26d1a8f` (main) · hands-on review, nothing changed in code_

Scope: the whole path a person takes, from the splash page through making a
bento to working on the board. I used every widget, the share and settings
dialogs, the error pages, keyboard use, dark mode and a phone-sized viewport.

How: this worktree's own servers (web on `:5174`, realtime on `:8788` with
its own `.wrangler/audit` store), driven in the desktop app's browser pane at
1024×768 and 375×812. Everything was done as one person: the board's owner.
The visitor join, password gate and viewer role were reviewed from the code,
not clicked through (see "Not covered").

Severity: **High** means it blocks or misleads people in a common flow.
**Medium** means friction most people will hit. **Low** is polish.

---

## Status after the follow-ups (same day, branch `claude/ui-ux-fixes`)

| #   | Outcome                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | **Fixed.** Every widget list is tagged `data-scroll`; the board marks an edge with more beyond it and `base.css` fades it. Something you add while typing scrolls into view           |
| H2  | **Fixed.** Below 900 px the bento fits the screen width by default (same layout, smaller; pinch to zoom). A "Fit to screen" / "Actual size" button beside + switches, kept per device |
| H3  | **Fixed.** A bare arrow key does nothing. Space picks a widget up, arrows preview (Shift resizes), Enter or Space puts it down, Esc cancels, all read out to screen readers           |
| M1  | **Fixed.** The splash and join screens suggest the last name you used on this device                                                                                                  |
| M2  | **Fixed.** A new widget scrolls into view, takes focus and flashes a ring; a new note opens for typing                                                                                |
| M3  | **Fixed.** The amount clears after − or + and focus returns to it                                                                                                                     |
| M4  | **Fixed.** "Give the event a name." shows under the field, with `aria-invalid`, and focus goes back to it                                                                             |
| M5  | **Fixed.** Free times: one cell in the tab order, arrows move, Space or Enter flips your half hour. Calendar month: arrows move between days, Enter opens one                         |
| M6  | **Fixed.** "Note deleted · Undo" for 13 s. New `restore` op (protocol v3): the box keeps a deleted widget in memory for `UNDO_MS` (15 s), for whoever deleted it                      |
| M7  | **Fixed.** Delete × and color swatches keep their look but take clicks over at least 24 px                                                                                            |
| M8  | **Fixed.** If the clipboard is refused, the link shows selected in a text field and an older copy method is tried                                                                     |
| M9  | **Fixed.** Until a password is saved the status says "Not on yet: set a password below." in red                                                                                       |
| L1  | **Fixed.** The color popover is opaque from its first frames and sits above the switches                                                                                              |
| L2  | **Fixed.** "place widgets freely" (splash and Settings)                                                                                                                               |
| L3  | **Fixed.** Each recent bento has a "Remove from this list" button (on hover, always on touch screens)                                                                                 |
| L4  | **Fixed.** The splash card is readable within the first third of its entry animation                                                                                                  |
| L5  | **Checked, no change.** A blank name becomes "Untitled bento" on the server                                                                                                           |
| L6  | **Fixed.** Dialogs (and the + picker) are opaque from early in their entry, so the board never shows through                                                                          |
| L7  | **Fixed.** "Note" in the + picker                                                                                                                                                     |
| L8  | **Fixed.** "Delete to-do"                                                                                                                                                             |
| L9  | **Fixed.** An empty note being edited shows the formatting as placeholder text                                                                                                        |
| L10 | **Fixed.** Ideas hold their order while your pointer or focus is in the list, and re-sort when you leave                                                                              |
| L11 | **Fixed.** "1 vote"                                                                                                                                                                   |
| L12 | **Fixed.** The event form lists the day's other events under "Also that day"                                                                                                          |
| L13 | **Fixed.** Month cells show the title only; the time stays in the tooltip and the week and day views                                                                                  |
| L14 | **Kept.** A week as a list per day reads well at widget sizes; a time axis would need far more room                                                                                   |
| L15 | **Kept.** Free times looks ahead from today on purpose (past days can't be planned); both show their date range                                                                       |
| L16 | **Fixed.** Free times folds its swatches into one dot                                                                                                                                 |
| L17 | **Fixed.** Your own "you" tag steps aside over buttons, menus and the delete card                                                                                                     |
| L18 | **Fixed.** One tab stop per swatch row (the current color); arrows move between them                                                                                                  |
| L19 | **Fixed.** The link status now says "No password needed."                                                                                                                             |
| L20 | **Fixed.** Comes with L6: the Select menu is opaque from early in its entry                                                                                                           |
| L21 | **Fixed.** "Clear bento", "Delete bento", "Bento privacy"                                                                                                                             |
| L22 | **Fixed.** The dot by your name in Settings opens the 18 colors. New `recolor` message; the server keeps it apart from others' colors, and it's kept for this device                  |
| L23 | **Fixed.** The Tips note's lines all end in a full stop (new starter bentos)                                                                                                          |
| L24 | **Kept.** The title's own row on a phone is deliberate; with fit-to-screen the board under it now shows whole                                                                         |
| L25 | **Fixed.** "Bento not found · benTogether", "Page not found · benTogether" and the other error headings                                                                               |
| dev | **Fixed.** No `STRICT_READ_UNTRACKED` on the splash                                                                                                                                   |

**Found while fixing:** a cleared free-times row stayed on screen ("Clear
mine" too). The client merged server records field by field but never
removed a field the server had dropped. `mergeInto` now prunes missing keys
(a note keeps its own in-flight text). Free times' per-cell lanes are also
keyed by person, which ends an `UNSTABLE_LIST_IDENTITY` warning on every
paint.

Verified with `npm run check` (148 unit tests, including new ones for
`restore` and `recolor`) and the full Playwright suite (29 passed, with a
new test for Undo) against this branch's servers on ports 5174 and 8788.
Each fix was also checked by hand in the browser pane, at desktop and phone
sizes. Multiplayer as a second person is still only covered by e2e.

---

## TL;DR

The core loop works well. Making a bento takes one click, the starter board
shows every widget, and every widget did what it says. Changes land at once.
Deleting asks first, and the error pages are warm and clear. The board reads
well in light and dark mode. The brand voice holds up in most copy.

The main problems:

1. **Hidden overflow.** Lists in widgets scroll with the scrollbar hidden.
   A new to-do item vanished below the fold, with nothing to show it's
   there (H1).
2. **Phones.** The board has a 900 px minimum width, so on a phone it scrolls
   sideways and most widgets are cut off (H2).
3. **Keyboard moves are live and sticky.** One arrow key on a focused widget
   moves it for everyone and pushes others down. Moving it back doesn't put
   them back (H3).
4. A group of smaller issues: no feedback when something is added off-screen,
   validation that only shows in toasts, a copy-link fallback, mixed naming
   ("Sticky Note", "Delete list", "Clear Bento"), and tap targets that are
   too small.

---

## Flow walkthrough

### 1. Splash (`/`)

What works

- Clear and quick: the bento name, your name and color, three switches and
  one button. "Create bento" says what it does.
- The blurred bento backdrop with drifting ghost cursors explains the product
  before you read anything.
- "Your recent bentos" fills in widget counts and live presence dots in the
  background. Boxes that were deleted drop off the list by themselves.
- On a phone the two columns stack neatly.

Issues

- **M1. The suggested name changes on every visit.** I made a bento as
  "Kombu". The next time I opened the splash it suggested "Ikura". Your color
  is remembered (`saveHue`), but your name isn't kept across bentos, only per
  box (`rememberName`). Returning people have to retype their name every
  time, or they end up with a different name in each bento.
  _Suggest:_ use the last name you used as the default, and suggest a random
  one only the first time.
- **L1. The color popover covers the "Live cursors" switch** (it opens below
  the Color button and overlaps the options list). It's harmless, but it
  looks crowded. Opening it upward, or giving it a solid backdrop, would fix it.
- **L2. The Auto-pack hint says "place notes freely".** It should say widgets
  (the brand guide uses _widget_ everywhere). The same text is in Settings.
- **L3. You can't remove a bento from the recent list**, and there's nowhere
  to paste a link to join one. The list only shrinks when a box is deleted.
  Once someone has a dozen bentos it gets noisy.
- **L4. The entry animation is slow on a phone.** For about 1–2 s the form is
  dimmed and the backdrop cells show through it, so it looks disabled.
- **L5. A blank bento name is allowed.** That's fine, but it's worth checking
  what title it gets, and whether the recent list and the toolbar then show
  something sensible.
- **Dev only:** Solid warns `STRICT_READ_UNTRACKED` eight times per load from
  `Splash.tsx:302` (`ref={(el) => (ghostEls[i()] = el)}` reads `i()` in a ref
  callback). Nobody sees it, but it's noise in the console.

### 2. Create → board

What works

- Navigation is instant, and the starter board is a good tour: every widget
  is filled with believable content, and the welcome note says how to drag,
  resize and add.
- The toolbar is clean: logo, rename, "by Kombu", "Just you viewing the
  bento", Share and Settings.

Issues

- **M2. A widget added from the + menu can land off-screen with no
  feedback.** I added a note. It appeared under the calendar, below the
  fold. The page didn't scroll to it, nothing was focused, and there was no
  highlight. On a full board it looks like nothing happened.
  _Suggest:_ scroll the new widget into view and focus it (put the caret in
  a note), or flash its outline.
- **L6. The "Add to bento" dialog draws in late.** Its first frame is
  underneath the widgets, with the backdrop not yet there. It sorts itself
  out after about 300 ms, but it looks like a glitch. Check the z-index or
  the order of the opening animation.
- **L7. The + menu calls it "Sticky Note".** Every other place calls it a
  note, and the brand guide says "note, not sticky". The same goes for the
  hint "place notes freely" (L2).

### 3. Widgets

#### To-do

- **H1. New items disappear below the fold.** I added "Bring snacks" as the
  7th item. The list area is a fixed height with `overflow-y: auto;
scrollbar-width: none` (`Todo.module.css:67`). The item was hidden under
  the "Add an item" row, with no scrollbar, fade or "+1 more". Only the
  "2/7" count gave it away.
  The same hidden scrollbar is used in `parts.module.css` (`.scroll`, shared
  by polls, ideas, asks and the calendar's day list), `WidgetFrame`, `Note`,
  `Calendar`, `FreeTimes` and `Budget`. Any of them can hide content the
  same way.
  _Suggest:_ a fade mask at the bottom edge when there's more to scroll
  (a scroll-driven CSS mask works without JS), or a thin scrollbar that
  shows on hover. And after adding an item, scroll it into view.
- **L8. The delete label says "Delete list"** while the widget is called
  "To-do". Pick one.

#### Note

- Click to edit, `Esc` to leave, and the Markdown (heading, **bold**, `- `
  list, `[ ]` box) renders well. `Enter` on a focused note also starts
  editing, which is good for keyboard users.
- **L9. Raw Markdown while editing.** That's expected, but a first-time
  user typing `**bold**` doesn't know it will render. A one-line hint in an
  empty note ("`-` for a list, `**bold**`, `[ ]` for a box") would teach it.

#### Budget

- −/+ work and the total animates nicely.
- **M3. The amount stays in the field after − or +.** This is on purpose
  (the comment in `Budget.tsx:104` says so, so repeating it is one click).
  But it makes an accidental double charge easy. After spending 35.50, the
  field still says 35.50 and the − button sits right next to it.
  _Suggest:_ clear the field, and keep "repeat" as a small "−35.50 again"
  chip in the history. Or at least select the text, so the next keystroke
  replaces it.

#### Timer

- Start, pause, +1m and reset all work. The "ready / running" status under
  the time is clear.

#### Poll

- Voting works, and the bar plus voter dots show the result well. "Several"
  (multi-pick) is a nice touch.

#### Ideas

- **L10. Upvoting moves the row under your pointer.** "Board game café"
  went from last to fifth the moment I voted, so the next click lands on a
  different idea. Consider waiting until the pointer leaves the list before
  re-sorting, or animating the move so people can follow it.
- **L11. Plurals in the screen-reader label:** "Vote for Cooking class,
  1 votes" (`Ideas.tsx:67`).

#### Asks

- Drilling into a person ("Mochi") and back works. The per-ask author dots
  and the "new" markers are clear.

#### Calendar

- Month, week and day views and Today all work. Clicking a day in month view
  opens that day.
- **M4. Validation only shows in a toast.** Saving an event with no name
  shows "Give the event a name." in a toast at the bottom of the screen, far
  from the field. The field itself shows nothing.
  _Suggest:_ mark the field (red underline and `aria-invalid`) and put the
  message under it, or turn off Save until there's a name.
- **L12. The add-event form covers the day's events.** In day view, the form
  fills the widget, so you can't see what's already planned while adding
  something.
- **L13. Month-view chips cut off almost all the text** ("10:00 AM Outin…").
  At normal widget sizes, show the title before the time, or drop the time
  in month view.
- **L14. Week view has no time axis**, so it's a list per day. That's fine,
  but then "Week" and "Month" differ less than people might expect.
- **L15. Weeks start on different days.** The calendar's week view runs
  Sun–Sat, while Free times shows a rolling Sat 21–Fri 27 from today. Two
  widgets next to each other show different weeks.

#### Free times

- Painting with a drag works. The hover tooltip lists who's free, "you"
  marks your own column, and "best: Sun 22 11 AM (3 of 4)" is a great
  summary.
- **L16. The footer is crowded:** "by bento", the people dots, "best: …",
  "Clear mine" and the 6 color swatches share one line. At the default size
  they touch.
- **M5. You can't fill it in with a keyboard.** The cells have labels
  ("Sun 22 11 AM: Mochi, Yuzu"), but they aren't focusable and there's no
  key to paint one (`FreeTimes.tsx`). The same goes for calendar day cells,
  which have `tabindex="-1"` (`Calendar.tsx:291`), though "Add an event"
  is still reachable by keyboard.

### 4. Moving, resizing, deleting

- Dragging by the body works, and the drop preview is accurate.
- **H3. Keyboard moves take effect at once, for everyone, and they stick.**
  With a widget focused (which a single Tab gets you), one `→` moved the
  welcome note one cell and pushed the budget down under it. Pressing `←`
  moved the note back, but the budget stayed down. A stray arrow key (for
  example someone pressing arrows to scroll the page) quietly rearranges a
  shared board.
  _Suggest:_ a "pick up" mode like most accessible drag-and-drop: Space or
  Enter grabs, arrows preview, Enter drops, Esc cancels. Or at least only
  push other widgets when the move is committed.
- **M6. No undo for deleting a widget.** There's a confirm card ("This
  removes the widget and content for everyone."), which is good. But once
  confirmed, it's gone. Since the server keeps everything, a short "Note
  deleted · Undo" toast would be safer and less tiring than a confirm step.
- **M7. The delete × is a small target**: 18×18 px (measured), under the
  WCAG 2.2 minimum of 24×24. The color swatches are about the same size.
- **L17. Your own "you" cursor tag covers the confirm card's Delete
  button.** The tag follows your pointer. It has `pointer-events: none`, so
  the click still works, but it hides the label of the button you're about
  to press. Hide your own tag while the pointer is over a dialog or button.
- **L18. Inconsistent color controls.** Budget, Timer and Poll show one
  "Color: Nori blue. Change" button. Note, To-do, Ideas and Asks put all
  6 swatches in the page. With a screen reader, or tabbing through, that's
  6 stops per widget. Use the single-button pattern everywhere.

### 5. Share dialog

- The link, who's viewing with roles, privacy and the default role for new
  visitors are all in one tidy dialog.
- **M8. "Copy link" failed, and the fallback didn't help much.** In the
  app's browser pane, the clipboard was refused and the toast said
  "Couldn't copy. Select the link and copy it instead." That's honest, but
  the link wasn't selected for you.
  _Suggest:_ select the text in the URL field when copying fails, so all
  that's left is ⌘C. (Some of this is down to the pane's permissions. A
  normal browser tab will usually succeed.)
- **M9. "Password protected" looks on before it is.** Choosing it in the
  menu changes the label and icon at once, but the hint says "Set a password
  to turn this on." If you close the dialog without setting one, the menu
  said one thing and the bento does another. Keep the menu on "Anyone with
  the link" until a password is saved, or show "Not on yet" next to it.
- **L19. Repeated text:** the "Anyone with the link" choice sits next to the
  hint "Anyone with the link can join."
- **L20. The Select menu shows the page through it** for a frame while it
  opens (the "New visitors" row showed through the options).

### 6. Settings dialog

- Name, live cursors, auto-pack, appearance (System, Light, Dark) and the
  destructive actions are each set apart clearly, and each asks again before
  acting.
- **L21. Title case on "Clear Bento" and "Delete Bento"**, while every other
  button uses sentence case ("Create bento", "Copy link"). The brand guide
  asks for plain buttons.
- **L22. You can't change your color after joining.** The dot next to your
  name in Settings is only for show. Only the splash lets you pick a color.
- **L23. The Tips note in the starter bento** has a line with no full stop
  ("Set new visitor permissions to view/edit"). The other two lines have one.

### 7. Theme

- Dark mode works well: the widgets keep their pastel fills on a near-black
  board, and the text contrast looks fine at a glance. Not measured with a
  contrast checker.

### 8. Phone (375×812)

- **H2. The board doesn't fit on a phone.** `.board { min-width: 900px }`
  (`Board.module.css:11`), so the page scrolls sideways and each widget is
  cut at the right edge. Keeping the same layout everywhere is a deliberate
  rule ("Same layout and line wraps for everyone, at any screen size"), but
  at 375 px it's hard to use: you can't see a whole row, and the + button
  sits on top of the calendar.
  _Suggest (keeping the rule):_ fit the 900 px board to the screen width and
  allow pinch-zoom, or add a "fit to screen" zoom mode. Or offer a read-only
  stacked view on narrow screens, with editing done one widget at a time.
- **L24. The toolbar wraps the bento title onto a second row** on a phone,
  and "Just you viewing the bento" becomes a single dot with no label.

### 9. Error and edge pages

- `/b/<missing>`: "Nothing in this bento. This bento doesn't exist, or it
  was cleared away." with "Start a new bento". Very good.
- `/some/random/path`: "Wrong bento. There's nothing at this address." with
  "Go home". Very good.
- **L25. The document title is just "benTogether"** on both. Something like
  "Bento not found · benTogether" helps with tabs and history.

---

## Accessibility summary

| #   | Issue                                                                      | Where                       |
| --- | -------------------------------------------------------------------------- | --------------------------- |
| M5  | Free times can't be painted by keyboard; calendar days aren't focusable    | `FreeTimes.tsx`, `Calendar` |
| H3  | A focused widget moves on a bare arrow key, with no grab or cancel         | `WidgetFrame.tsx`           |
| M7  | Delete × and color swatches are about 18 px, under the 24 px target        | `WidgetFrame`, `ColorTools` |
| M4  | Form errors only in toasts; no `aria-invalid` or message on the field      | Calendar event form         |
| L18 | 6 color-swatch buttons per widget in the tab order on four widget types    | `ColorTools`                |
| L11 | "1 votes" in the ideas vote label                                          | `Ideas.tsx:67`              |
| H1  | Hidden scrollbars hide content from people who can't see that there's more | 8 CSS modules               |

What's good: every widget is an `article` with a useful label ("To-do by
bento: Before the outing, 2 of 6 done"). The toolbar buttons have names.
Focus has a visible outline. Closing a dialog with `Esc` returns focus to
the button that opened it, and `Enter` edits a note.

---

## Suggested order

1. **H1** hidden overflow: a CSS fade, plus scrolling new items into view.
   Small change, big win.
2. **M2** scroll to and focus newly added widgets.
3. **H3** keyboard grab mode for moving widgets.
4. **M1** remember the last name you used.
5. **M9, M8** share dialog state and the copy fallback.
6. **M3, M4, M6** budget field, inline validation, undo after delete.
7. **H2** phone strategy. This is a product decision more than a bug, so
   worth its own discussion.
8. The Low items, in one copy-and-polish pass (L2, L7, L8, L21, L23 are all
   one-word fixes).

## Not covered

- **Multiplayer as a second person.** Every test ran in one browser profile,
  so as the owner. Joining with a name, the password gate, the viewer role
  (can vote but can't edit), name clashes, and live cursors from someone
  else weren't clicked through. The e2e suite covers some of this. A
  follow-up with two profiles (or the Playwright multi-browser setup) would
  close the gap.
- Reconnecting, "outdated version" and over-capacity states.
- Screen reader testing with VoiceOver, and measured color contrast.
- Touch gestures on a real phone (drag, resize, painting free times).
