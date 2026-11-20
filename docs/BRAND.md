# benTogether — brand guide

> **bento + together.** Pack ideas into a bento together.

A bento box is a small shared table: the box holds the shape, the
compartments keep things tidy, and what goes inside is up to the people
around it. benTogether is a live board built the same way. The **box** is the
board, the **compartments** are widgets snapped to a grid, and the
**people** are the colored cursors filling them in at the same moment.

The brand should feel like a well-packed lunch: warm, tidy, a little playful,
never cluttered.

---

## Name

- Always written **benTogether**: lowercase "ben", capital "T", lowercase
  "ogether". Never "Bentogether", "BenTogether", "bentogether" or
  "Bento Together".
- The capital T marks where the two words meet. "benTo" is the box,
  "Together" is the people, and the **T** belongs to both, the way a shared
  compartment belongs to everyone.
- In the wordmark, **"benTo" is underlined** with a shu (lacquer red) rule,
  like the edge of a bento box. "gether" sits off the line. In running text
  the name is plain, with no underline.
- Code identifiers, package names and URLs use lowercase `bentogether`.

## Vocabulary

| Say          | Not                | Why                                     |
| ------------ | ------------------ | --------------------------------------- |
| box          | board, workspace   | The board is the bento box.             |
| compartment  | widget, card, tile | In UI copy. Code can say `widget`.      |
| note         | sticky, post-it    | The first kind of compartment.          |
| in the bento | online, active     | Presence: "3 in this bento".            |
| pack / fill  | create / populate  | Use sparingly, once per screen at most. |

Keep food metaphors to one per screen. The metaphor is the seasoning, not
the meal.

## Tagline and lede

- Tagline: **Pack ideas into a bento together.**

Say what it is, then stop. Hints under controls are one short line each
("See where everyone is pointing.", "Begin with a short how-to.").

## Voice

- **Warm and brief.** Short sentences. No exclamation marks in system copy.
- **Plain over clever.** A button says what it does: "New box", "Add note",
  "Copy link".
- **People first.** Name the person, not the system: "Mochi is editing",
  never "Locked by another user".

Examples:

- Empty box: "An empty box. Add a note to fill the first compartment."
- Connecting: rotates through `LOADING_LINES` in `ui/LoadingLine.tsx`, e.g. "Joining the bento…", "Opening the lid…"
- Reconnecting: "Lost the connection. Reconnecting…"
- Missing box: "This box doesn't exist, or it was cleared away."

## Logo

The mark is a top-down bento box: a rounded lacquer square split into four
unequal compartments, the same uneven grid the product uses. One compartment
is filled with shu. Next to the mark is the **benTogether** wordmark,
set in Bricolage Grotesque, with a shu rule under "benTo".

- Minimum size: 20px mark, 96px lockup.
- Clear space: one compartment gutter (1/8 of the mark) on every side.
- On dark backgrounds the lacquer frame turns rice-colored. Shu stays shu.
- Don't recolor the compartments with cursor colors, add depth or gloss, or
  put the mark on a busy background.

Source: `apps/web/src/brand/Logo.tsx`.

## Color

Colors are defined once as CSS custom properties in
`apps/web/src/styles/tokens.css`. Components only use tokens.

### Foundation: lacquer and rice

| Token             | Light     | Dark      | Use                           |
| ----------------- | --------- | --------- | ----------------------------- |
| `--rice`          | `#f6f1e7` | `#171311` | Page background               |
| `--rice-raised`   | `#fbf8f2` | `#211b18` | Box surface, popovers         |
| `--rice-sunk`     | `#ece4d4` | `#120f0d` | Empty grid cells, wells       |
| `--lacquer`       | `#1f1a17` | `#efe7da` | Primary text, box frame       |
| `--lacquer-soft`  | `#5b514a` | `#b9ada0` | Secondary text                |
| `--lacquer-faint` | `#8f8378` | `#7d7268` | Hints, placeholders           |
| `--bamboo`        | `#ddd1bb` | `#3a312b` | Dividers, compartment edges   |
| `--shu`           | `#c8442f` | `#e0634d` | Brand accent, primary buttons |

**Shu** (朱, vermilion lacquer) is the single brand accent. Use it for the
primary action, focus rings and the underline under "benTo" in the
wordmark. Never use it for errors
(errors use `--danger`) or as a note color.

### Ingredients: note colors

Notes come in six ingredient colors. They're soft pastels, so a full box
reads as a balanced meal rather than a rainbow.

| Token           | Ingredient      | oklch (light)    |
| --------------- | --------------- | ---------------- |
| `--ing-tamago`  | rolled omelette | `0.92 0.085 95`  |
| `--ing-sake`    | salmon          | `0.86 0.07 45`   |
| `--ing-edamame` | soybean         | `0.89 0.075 140` |
| `--ing-ume`     | pickled plum    | `0.87 0.06 355`  |
| `--ing-nori`    | seaweed tint    | `0.88 0.045 210` |
| `--ing-shiso`   | perilla         | `0.86 0.05 305`  |

In dark mode the ingredients stay light pastels, a little muted
(`L ≈ 0.75–0.80`, lower chroma), like paper notes on a dark table. Note
contents always use dark ink (`--note-ink`) in both themes.

### People: cursor colors

People get one of **18 vivid palette colors**, 20° apart around the wheel
(`PERSON_PALETTE` in `packages/shared/src/identity.ts`). Hue alone can't
separate 18 colors, so each tone has its own lightness and chroma: yellows
and limes bright, blues and indigos deep. Neighbours differ in brightness as
well as hue. Dark mode lifts every tone by `--person-dl`.

Text on a person's color: cursor name pills are always white (with a faint
shadow so it holds on the bright tones). Other chips (avatars, caret flags)
use `personInk`: white on the deep tones, ink on the light ones.

Your color is yours on this device (pick it from the "Color" pill in the name field).
In a bento, the server keeps your color if it's free; otherwise you get the
free color farthest from everyone present. Two people share a color only
once all 18 are taken.

Cursor colors are brighter and more saturated than the ingredients, so a
cursor never disappears into a note.

## Byline

Bottom left of every note is the byline: **"by [name]"**, in mono. Starter
notes, which the box writes itself, read **"by bento"**. While someone is
typing in a note, the byline becomes "[name] is typing" with a dot in their
color. The bottom-right corner stays empty until hover, when the resize grip
(two hairline strokes) appears.

## Typography

| Role    | Family                         | Use                                    |
| ------- | ------------------------------ | -------------------------------------- |
| Display | Bricolage Grotesque (variable) | Wordmark, box titles, empty states     |
| UI      | Instrument Sans (variable)     | Buttons, notes, body                   |
| Mono    | IBM Plex Mono                  | Cursor name pills, metadata, shortcuts |

All three are self-hosted through `@fontsource`. There's no runtime call to a
font CDN.

Scale: `--step-*` in rem, with a fluid root size (about 17px at 1080p, 20px at
2K, 26px at 4K at 100% scaling). Note text instead scales with the grid cell,
so every viewer sees the same line wraps, and comes in four sizes per note:
S, M (default), L and XL.

## Shape and layout

- **The grid is the brand.** 12 columns, square-ish rows, tight even gutters
  (`--gutter`), like the dividers in a real bento.
- **Compartments** have a `--radius` of 14px and sit in a box with a slightly
  larger outer radius (`--radius-box`), as if a lacquer frame were holding
  them.
- No drop shadows at rest. A compartment lifts (shadow plus a 1.02 scale)
  only while it's being dragged.

## Motion

- **Snap, don't float.** Compartments settle into cells with a short spring
  (`--ease-snap`, about 180ms) as if pressed into a box.
- Remote cursors are interpolated, so other people's movement looks smooth
  even though updates arrive only 20 times a second.
- Cursor name pills type their action in and out (`mochi · typing`),
  borrowed from the kumi-agents cursor style.
- `prefers-reduced-motion`: springs become instant and cursor tags stop
  typing. Positions still update.

## Cursors

Cursors follow the kumi-agents style:

- Your own pointer is a CSS cursor image of the same glyph in your color
  (hardware-drawn, no lag). Everyone else's is drawn in the page.
- Flat pointer glyphs filled with the person's color and a fine ink edge:
  **dart** (moving), **hand** (over something clickable), **grab** (dragging),
  **i-beam** (typing in a note).
- A rounded mono pill next to the tip: `name · action`, where the action
  types itself in (`typing`, `moving a note`, `resizing`).
- While someone is typing in a note, other viewers see a caret in that
  person's color inside the note, with a small flag showing their name.
- A compartment someone is editing gets a 2px ring in their color.

## Light and dark

Both themes are first-class. By default the app follows the system; anyone
can override it for themselves in Settings → Appearance (System / Light /
Dark), kept on their device and applied before first paint.

## Accessibility

- Text on ingredient colors meets WCAG AA (4.5:1) with `--lacquer` in both
  themes.
- Focus is always visible: a 2px shu ring offset by 2px.
- Cursors and carets are decorative (`aria-hidden`). Presence is also listed
  in the people list, which is screen-reader friendly.
- Every pointer action (move, resize, delete) has a keyboard path.
