import { For } from "solid-js";
import type { JSX } from "@solidjs/web";
import { CursorTag } from "../cursors/CursorTag";
import { Pointer, type PointerVariant } from "../cursors/Pointer";
import { personVars } from "../lib/identity";
import styles from "./Splash.module.css";

/** Decorative compartments behind the modal: a packed box, out of focus. */
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
 * Full-screen backdrop of a packed bento box with two people at work,
 * plus a centered modal card for whatever the page needs to ask.
 */
/** Mock people at work behind the modal. Positions in % of the screen. */
const GHOSTS: Array<{
  name: string;
  hue: number;
  variant: PointerVariant;
  action: string | null;
  left: number;
  top: number;
  drift: 0 | 1 | 2 | 3;
}> = [
  { name: "Mochi", hue: 10, variant: "ibeam", action: "typing", left: 18, top: 24, drift: 0 },
  { name: "Yuzu", hue: 210, variant: "grab", action: "moving", left: 72, top: 64, drift: 1 },
  { name: "Nori", hue: 130, variant: "hand", action: null, left: 86, top: 18, drift: 2 },
  { name: "Ikura", hue: 330, variant: "grab", action: "resizing", left: 9, top: 72, drift: 3 },
  { name: "Shiso", hue: 290, variant: "dart", action: null, left: 44, top: 88, drift: 1 },
  { name: "Tamago", hue: 70, variant: "ibeam", action: "typing", left: 60, top: 9, drift: 2 },
  { name: "Kombu", hue: 250, variant: "dart", action: "adding a note", left: 92, top: 82, drift: 0 },
];

/**
 * Full-screen backdrop of a packed bento box with people at work, plus a
 * centered modal card for whatever the page needs to ask.
 */
export function Splash(props: { children: JSX.Element; label: string; size?: "wide" }) {
  return (
    <div class={styles.splash}>
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
          {(g) => (
            <div
              class={styles.ghostCursor}
              data-drift={g.drift}
              style={{
                ...personVars(g.hue),
                left: `${g.left}%`,
                top: `${g.top}%`,
              }}
            >
              <Pointer variant={g.variant} />
              <CursorTag name={g.name} action={g.action} flipX={g.left > 80} reduceMotion={true} />
            </div>
          )}
        </For>
      </div>
      <div class={styles.scrim} aria-hidden="true" />
      <section
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
