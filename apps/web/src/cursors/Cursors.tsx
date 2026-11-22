import { createEffect, createMemo, For, onSettled, Show } from "solid-js";
import type { Action, Peer } from "@bentogether/shared";
import { personVars } from "../lib/identity";
import { CursorTag } from "./CursorTag";
import { Pointer, type PointerVariant } from "./Pointer";
import styles from "./Cursors.module.css";

/** Tag width guess for flipping before the first measurement. */
const TAG_ROOM = 170;

export function variantFor(action: Action | null): PointerVariant {
  if (action === "typing") return "ibeam";
  if (action === "resizing") return "resize";
  if (action === "moving") return "grab";
  return "dart";
}

/**
 * Everyone else's cursors. Positions arrive in grid units about 20 times a
 * second; each cursor eases toward its latest target on its own animation
 * frame and writes `transform` directly, so a moving cursor updates one
 * style property and never re-renders anything.
 */
export function RemoteCursors(props: { peers: Peer[]; pitch: number; width: number; reduceMotion: boolean }) {
  return (
    <div class={styles.layer} aria-hidden="true">
      <For each={props.peers} keyed={(p) => p.sid}>
        {(peer) => (
          // While someone's caret is in a note, the caret (with its "typing"
          // flag) stands in for their cursor, so it isn't shown twice.
          <Show when={!peer().presence.caret}>
            <RemoteCursor
              name={peer().name}
              hue={peer().hue}
              x={peer().presence.cursor?.x ?? null}
              y={peer().presence.cursor?.y ?? null}
              action={peer().presence.action}
              pitch={props.pitch}
              width={props.width}
              reduceMotion={props.reduceMotion}
            />
          </Show>
        )}
      </For>
    </div>
  );
}

function RemoteCursor(props: {
  name: string;
  hue: number;
  x: number | null;
  y: number | null;
  action: Action | null;
  pitch: number;
  width: number;
  reduceMotion: boolean;
}) {
  let el!: HTMLDivElement;
  const target = { x: 0, y: 0 };
  const pos = { x: 0, y: 0 };
  let placed = false;
  let frame = 0;
  let snap = false;

  let last = 0;
  const animate = (now: number) => {
    frame = 0;
    // Time-based easing (~35ms time constant): smooths 20 Hz updates
    // without trailing far behind, at any display refresh rate.
    const dt = last ? Math.min(64, now - last) : 16;
    last = now;
    const k = snap ? 1 : 1 - Math.exp(-dt / 35);
    pos.x += (target.x - pos.x) * k;
    pos.y += (target.y - pos.y) * k;
    el.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;
    if (Math.abs(target.x - pos.x) > 0.3 || Math.abs(target.y - pos.y) > 0.3)
      frame = requestAnimationFrame(animate);
  };

  createEffect(
    () => [props.x, props.y, props.pitch, props.reduceMotion] as const,
    ([x, y, pitch, reduce]) => {
      if (x === null || y === null) return;
      target.x = x * pitch;
      target.y = y * pitch;
      snap = reduce;
      if (!placed) {
        // First sighting: appear in place rather than flying in from 0,0.
        pos.x = target.x;
        pos.y = target.y;
        placed = true;
      }
      if (!frame) frame = requestAnimationFrame(animate);
    },
  );
  onSettled(() => () => cancelAnimationFrame(frame));

  const visible = createMemo(() => props.x !== null && props.y !== null);
  const flipX = createMemo(() => props.x !== null && props.x * props.pitch + TAG_ROOM > props.width);

  return (
    <div ref={el} class={styles.cursor} data-visible={visible()} style={personVars(props.hue)}>
      <Pointer variant={variantFor(props.action)} />
      <CursorTag
        name={props.name}
        action={props.action === "idle" ? null : props.action}
        flipX={flipX()}
        reduceMotion={props.reduceMotion}
      />
    </div>
  );
}

/**
 * The "you · action" pill beside your own pointer. The pointer itself is a
 * CSS cursor; the board writes this element's transform directly from
 * `pointermove`, so the pill keeps up with it without a reactive hop.
 */
export function SelfTag(props: {
  ref: (el: HTMLDivElement) => void;
  hue: number;
  name: string;
  action: string | null;
  visible: boolean;
  flipX: boolean;
  reduceMotion: boolean;
}) {
  return (
    <div class={styles.layer} aria-hidden="true">
      <div
        ref={props.ref}
        class={[styles.cursor, styles.self]}
        data-visible={props.visible}
        style={personVars(props.hue)}
      >
        <CursorTag
          name={props.name}
          action={props.action}
          flipX={props.flipX}
          reduceMotion={props.reduceMotion}
        />
      </div>
    </div>
  );
}
