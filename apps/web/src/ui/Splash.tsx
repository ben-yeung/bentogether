import { createSignal, For, onSettled } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { Action } from "@bentogether/shared";
import { variantFor } from "../cursors/Cursors";
import { CursorTag } from "../cursors/CursorTag";
import { Pointer, type PointerVariant } from "../cursors/Pointer";
import { personVars } from "../lib/identity";
import styles from "./Splash.module.css";

/** Decorative widgets behind the modal: a packed box, out of focus. */
const CELLS: Array<[x: number, y: number, w: number, h: number, color: string]> = [
  [0, 0, 4, 3, "tamago"],
  [4, 0, 3, 2, "sake"],
  [7, 0, 5, 3, "edamame"],
  [4, 2, 3, 3, "nori"],
  [0, 3, 2, 3, "ume"],
  [2, 3, 2, 2, "shiso"],
  [7, 3, 3, 3, "sake"],
  [10, 3, 2, 2, "tamago"],
  [2, 5, 5, 2, "edamame"],
  [10, 5, 2, 3, "ume"],
  [0, 6, 2, 2, "nori"],
  [7, 6, 3, 2, "shiso"],
  [2, 7, 3, 2, "tamago"],
  [5, 7, 2, 2, "sake"],
];

/**
 * Mock people at work in the open space around the modal. Where each one
 * starts is worked out from the actual layout (see `scatter`), and where it
 * wanders next too (see `wander`), so none of them ever passes behind the
 * card at any viewport size.
 */
const GHOSTS: Array<{
  name: string;
  hue: number;
  /** Pointer while idle; otherwise the action picks it, as on the board. */
  rest: PointerVariant;
  /** What this person tends to be doing between moves. */
  habits: Action[];
}> = [
  { name: "Mochi", hue: 10, rest: "dart", habits: ["typing", "typing", "adding a note"] },
  { name: "Yuzu", hue: 210, rest: "dart", habits: ["resizing", "recoloring"] },
  { name: "Nori", hue: 130, rest: "hand", habits: ["recoloring"] },
  { name: "Ikura", hue: 330, rest: "dart", habits: ["resizing", "typing"] },
  { name: "Shiso", hue: 290, rest: "dart", habits: ["adding a note"] },
  { name: "Tamago", hue: 70, rest: "dart", habits: ["typing", "recoloring"] },
  { name: "Kombu", hue: 250, rest: "dart", habits: ["adding a note", "typing", "resizing"] },
  { name: "Ebi", hue: 25, rest: "hand", habits: ["typing"] },
];

/** Something to be doing while resting: one of their habits, or nothing much. */
const pickRest = (g: number): Action | null => {
  const habits = GHOSTS[g]!.habits;
  return Math.random() < 0.35 ? null : habits[Math.floor(Math.random() * habits.length)]!;
};

/** The pill's widest label, `name · action`, in em of the mono pill font. */
const widestLabel = GHOSTS.map(
  (g) => g.name.length + Math.max(0, ...g.habits.map((h) => h.length + 1), "moving".length + 1),
);

type Box = { l: number; t: number; r: number; b: number };
type Spot = { x: number; y: number; flip: boolean } | null;
type Field = { w: number; h: number; card: Box; tagWidths: number[]; rem: number };

const overlaps = (a: Box, b: Box) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;

/** A small seeded PRNG, so a resize re-flows the same scatter instead of reshuffling it. */
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Each cursor's idle sway (in rem) while it rests between moves, picked once per visit. */
const SWAY = GHOSTS.map(() => {
  const angle = Math.random() * Math.PI * 2;
  const reach = 0.2 + Math.random() * 0.35;
  return {
    dx: Math.cos(angle) * reach,
    dy: Math.sin(angle) * reach,
    tempo: 3 + Math.random() * 3,
    // A negative delay starts each one mid-sway, out of step with the rest.
    phase: -Math.random() * 6,
  };
});

/**
 * The space a cursor at (x, y) takes up: its pointer plus its pill, which
 * trails right of the pointer or, flipped, left of it. Padded for the sway.
 */
function footprint(f: Field, g: number, x: number, y: number, flip: boolean): Box {
  const tagW = f.tagWidths[g] ?? 0;
  const sway = 0.6 * f.rem;
  return {
    l: x - (flip ? tagW + 0.6 * f.rem : 0.7 * f.rem) - sway,
    r: x + (flip ? 1.3 * f.rem : 1.05 * f.rem + tagW) + sway,
    t: y - 0.6 * f.rem - sway,
    b: y + 2.7 * f.rem + sway,
  };
}

/** On screen and clear of the card. */
function open(f: Field, box: Box) {
  const pad = 0.25 * f.rem;
  if (box.l < pad || box.t < pad || box.r > f.w - pad || box.b > f.h - pad) return false;
  return !overlaps(box, f.card);
}

/**
 * Best-candidate scatter: each cursor tries random spots in the open space
 * around the modal (the strips above, below and beside it, picked in
 * proportion to their size), drops any whose footprint would touch the
 * modal, leave the screen or land on an earlier cursor, and keeps the one
 * farthest from those already placed. That spreads them out unevenly,
 * corners included, rather than in a ring. A cursor with nowhere to go (a
 * phone with a tall card) sits out.
 */
function scatter(seed: number, f: Field): Spot[] {
  const rand = mulberry32(seed);
  const { card } = f;
  const strips: Box[] = [
    { l: 0, t: 0, r: f.w, b: card.t },
    { l: 0, t: card.b, r: f.w, b: f.h },
    { l: 0, t: card.t, r: card.l, b: card.b },
    { l: card.r, t: card.t, r: f.w, b: card.b },
  ].filter((s) => s.r > s.l && s.b > s.t);
  const weights = strips.map((s) => (s.r - s.l) * (s.b - s.t));
  const total = weights.reduce((a, b) => a + b, 0);
  const pick = () => {
    let n = rand() * total;
    for (let i = 0; i < strips.length; i++) if ((n -= weights[i]!) <= 0) return strips[i]!;
    return strips[strips.length - 1]!;
  };

  const placed: Array<{ x: number; y: number; box: Box }> = [];
  return f.tagWidths.map((_, g) => {
    if (!total) return null;
    let best: { x: number; y: number; flip: boolean; box: Box; score: number } | null = null;
    for (let i = 0; i < 80; i++) {
      const s = pick();
      const x = s.l + rand() * (s.r - s.l);
      const y = s.t + rand() * (s.b - s.t);
      // The pill trails left of the pointer on the right half of the screen.
      const flip = x > f.w / 2;
      const box = footprint(f, g, x, y, flip);
      if (!open(f, box) || placed.some((p) => overlaps(box, p.box))) continue;
      const score = Math.min(Infinity, ...placed.map((p) => Math.hypot(p.x - x, p.y - y)));
      if (!best || score > best.score) best = { x, y, flip, box, score };
    }
    if (!best) return null;
    placed.push(best);
    return { x: best.x, y: best.y, flip: best.flip };
  });
}

/**
 * Somewhere new for cursor `g` to wander to: usually a short hop, now and
 * then a longer trip. The whole glide (sampled along the way) must stay
 * clear of the card, and the destination clear of where the others are
 * headed. It keeps its pill side, so the pill never jumps mid-glide.
 */
function wander(f: Field, spots: Spot[], g: number): Spot {
  const from = spots[g];
  if (!from) return null;
  const others = spots.flatMap((s, i) => (s && i !== g ? [footprint(f, i, s.x, s.y, s.flip)] : []));
  for (let i = 0; i < 30; i++) {
    const far = Math.random() < 0.25;
    const dist = f.rem * (far ? 8 + Math.random() * 16 : 2.5 + Math.random() * 7);
    const angle = Math.random() * Math.PI * 2;
    const x = from.x + Math.cos(angle) * dist;
    const y = from.y + Math.sin(angle) * dist;
    const box = footprint(f, g, x, y, from.flip);
    if (others.some((o) => overlaps(box, o))) continue;
    const steps = Math.ceil(dist / f.rem);
    let clear = true;
    for (let s = 1; s <= steps && clear; s++) {
      const t = s / steps;
      clear = open(f, footprint(f, g, from.x + (x - from.x) * t, from.y + (y - from.y) * t, from.flip));
    }
    if (clear) return { x, y, flip: from.flip };
  }
  return from;
}

/**
 * Full-screen backdrop of a packed bento box with people at work, plus a
 * centered modal card for whatever the page needs to ask.
 */
export function Splash(props: { children: JSX.Element; label: string; size?: "wide" }) {
  const seed = Math.floor(Math.random() * 2 ** 31);
  const [spots, setSpots] = createSignal<Spot[]>(GHOSTS.map(() => null));
  // How long each cursor's current glide takes; 0 while (re)placing.
  const [glides, setGlides] = createSignal<number[]>(GHOSTS.map(() => 0));
  const [actions, setActions] = createSignal<Array<Action | null>>(GHOSTS.map((_, g) => pickRest(g)));
  // Reduced motion: no wandering, and pills swap labels without typing.
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const [still, setStill] = createSignal(reduced.matches);
  const onReduced = () => setStill(reduced.matches);
  reduced.addEventListener("change", onReduced);
  let root!: HTMLDivElement;
  let modal!: HTMLElement;
  const ghostEls: HTMLDivElement[] = [];

  onSettled(() => {
    let field: Field | null = null;
    const layout = () => {
      const area = root.getBoundingClientRect();
      const m = modal.getBoundingClientRect();
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      field = {
        w: area.width,
        h: area.height,
        // The card, plus a little breathing room.
        card: {
          l: m.left - area.left - 0.5 * rem,
          t: m.top - area.top - 0.5 * rem,
          r: m.right - area.left + 0.5 * rem,
          b: m.bottom - area.top + 0.5 * rem,
        },
        // The pill at its widest, so its action can change without a relayout:
        // a monospace glyph is 0.6em; plus the pill's padding and the gaps
        // around the separator.
        tagWidths: ghostEls.map((el, g) => {
          const em = parseFloat(getComputedStyle(el.lastElementChild ?? el).fontSize) || rem;
          return em * (0.6 * widestLabel[g]! + 1.3 + 0.8) + 2;
        }),
        rem,
      };
      setGlides(GHOSTS.map(() => 0));
      setSpots(scatter(seed, field));
    };
    layout();
    const ro = new ResizeObserver(layout);
    ro.observe(root);
    ro.observe(modal);

    const setAction = (g: number, a: Action | null) => setActions((s) => s.map((v, i) => (i === g ? a : v)));

    // Each cursor rests a moment, busy with something or not, then either
    // glides somewhere new (sometimes dragging, pill reading "moving") or
    // stays put and turns to something else; each on its own clock.
    const timers: number[] = [];
    const landings: number[] = [];
    const tick = (g: number, after = 0) => {
      timers[g] = window.setTimeout(
        () => {
          // How long this turn's glide and settling take, before the next rest.
          let busy = 0;
          if (field && !still()) {
            const from = spots()[g];
            const to = Math.random() < 0.55 ? wander(field, spots(), g) : from;
            if (from && to && to !== from) {
              const dist = Math.hypot(to.x - from.x, to.y - from.y) / field.rem;
              const glide = 900 + dist * 90;
              setAction(g, Math.random() < 0.5 ? "moving" : null);
              setGlides((d) => d.map((v, i) => (i === g ? glide : v)));
              setSpots((s) => s.map((v, i) => (i === g ? to : v)));
              // Settles in for a beat after landing before taking up something new.
              busy = glide + 600 + Math.random() * 900;
              landings[g] = window.setTimeout(() => setAction(g, pickRest(g)), busy);
            } else {
              // Standing still: only sometimes turns to something else.
              if (Math.random() < 0.5) setAction(g, pickRest(g));
            }
          }
          tick(g, busy);
        },
        // The first moves trickle in over a couple of seconds; after that,
        // each rests 3–8s once it has landed and settled.
        after + (timers[g] === undefined ? 400 + Math.random() * 2000 : 3000 + Math.random() * 5000),
      );
    };
    GHOSTS.forEach((_, g) => tick(g));

    return () => {
      ro.disconnect();
      timers.forEach((t) => clearTimeout(t));
      landings.forEach((t) => clearTimeout(t));
      reduced.removeEventListener("change", onReduced);
    };
  });

  return (
    <div ref={root} class={styles.splash}>
      <div class={styles.backdrop} aria-hidden="true">
        <div class={styles.grid}>
          <For each={CELLS}>
            {([x, y, w, h, color]) => (
              <div
                class={styles.cell}
                data-color={color}
                style={{ "--x": x, "--y": y, "--w": w, "--h": h }}
              />
            )}
          </For>
        </div>
        <For each={GHOSTS}>
          {(g, i) => {
            const spot = () => spots()[i()];
            return (
              <div
                // GHOSTS never changes, so its own index is fixed (no reactive read here).
                ref={(el) => (ghostEls[GHOSTS.indexOf(g)] = el)}
                class={styles.ghostCursor}
                data-placed={spot() ? "" : undefined}
                style={{
                  ...personVars(g.hue),
                  "--dx": `${SWAY[i()]!.dx.toFixed(2)}rem`,
                  "--dy": `${SWAY[i()]!.dy.toFixed(2)}rem`,
                  "--tempo": `${SWAY[i()]!.tempo.toFixed(1)}s`,
                  "--phase": `${SWAY[i()]!.phase.toFixed(1)}s`,
                  "--glide": `${Math.round(glides()[i()] ?? 0)}ms`,
                  left: `${spot()?.x ?? 0}px`,
                  top: `${spot()?.y ?? 0}px`,
                }}
              >
                <Pointer variant={actions()[i()] ? variantFor(actions()[i()]!) : g.rest} />
                <CursorTag
                  name={g.name}
                  action={actions()[i()] ?? null}
                  flipX={spot()?.flip ?? false}
                  reduceMotion={still()}
                />
              </div>
            );
          }}
        </For>
      </div>
      <div class={styles.scrim} aria-hidden="true" />
      <section
        ref={modal}
        class={styles.modal}
        data-size={props.size}
        role="dialog"
        aria-modal="true"
        aria-label={props.label}
      >
        {props.children}
      </section>
    </div>
  );
}
