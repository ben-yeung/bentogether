import { createEffect, createSignal, Show } from "solid-js";
import styles from "./CursorTag.module.css";

const TYPE_MS = 34;
const ERASE_MS = 18;

/**
 * The pill riding next to a cursor: `name · action`. The action types
 * itself in and out (erase back to the shared prefix, then type the rest),
 * and the pill's width eases to fit, as in the kumi-agents cursors.
 */
export function CursorTag(props: {
  name: string;
  action: string | null;
  flipX: boolean;
  reduceMotion: boolean;
}) {
  const [shown, setShown] = createSignal("");
  // The text on screen, mirrored outside the graph: an effect's apply
  // phase must not read signals (STRICT_READ_UNTRACKED).
  let current = "";
  let tag!: HTMLDivElement;
  let inner!: HTMLSpanElement;

  // Split effect: compute tracks the goal, apply runs the typing timer and
  // returns its cleanup, which runs before the next goal starts typing.
  createEffect(
    () => [props.action ?? "", props.reduceMotion] as const,
    ([goal, instant]) => {
      let timer = 0;
      const step = () => {
        if (current === goal) return;
        if (instant) current = goal;
        else if (goal.startsWith(current)) current = goal.slice(0, current.length + 1);
        else current = current.slice(0, -1);
        setShown(current);
        if (current !== goal) timer = window.setTimeout(step, goal.startsWith(current) ? TYPE_MS : ERASE_MS);
      };
      timer = window.setTimeout(step, 0);
      return () => clearTimeout(timer);
    },
  );

  // Size the pill to its content on every typed character.
  createEffect(
    () => [shown(), props.name],
    () => {
      tag.style.setProperty("--w", `${inner.offsetWidth}px`);
    },
  );

  return (
    <div ref={tag} class={styles.tag} data-flip-x={props.flipX} data-animate={!props.reduceMotion}>
      <span ref={inner} class={styles.inner}>
        <span class={styles.name}>{props.name}</span>
        <Show when={shown()}>
          <span class={styles.sep} aria-hidden="true">
            ·
          </span>
          <span>{shown()}</span>
        </Show>
      </span>
    </div>
  );
}
