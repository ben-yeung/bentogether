import { createSignal, For, onCleanup } from "solid-js";
import styles from "./LoadingLine.module.css";

/** What a bento is doing while it opens. Rotates so a slow load still feels alive. */
export const LOADING_LINES = [
  "Joining the bento…",
  "Opening the lid…",
  "Organizing the bento…",
  "Arranging the widgets…",
  "Unpacking the notes…",
  "Making room for you…",
] as const;

const ROTATE_MS = 1800;

/** A random line to start, then the next one every couple of seconds. */
export function LoadingLine() {
  const [i, setI] = createSignal(Math.floor(Math.random() * LOADING_LINES.length));
  const timer = setInterval(() => setI((n) => (n + 1) % LOADING_LINES.length), ROTATE_MS);
  onCleanup(() => clearInterval(timer));
  return (
    <>
      {/* Screen readers hear one steady line, not every rotation. */}
      <span class="visually-hidden">Opening the bento…</span>
      <span aria-hidden="true" class={styles.slot}>
        {/* Keyed by text: each new line mounts fresh, so its fade-in plays. */}
        <For each={[LOADING_LINES[i()]!]} keyed={(line) => line}>
          {(line) => <span class={styles.line}>{line()}</span>}
        </For>
      </span>
    </>
  );
}
