import { For } from "solid-js";
import styles from "./Preview.module.css";

/** Each column is a day; each bar is someone free, from `top` for `len` rows of six. */
const DAYS: ReadonlyArray<ReadonlyArray<{ c: string; top: number; len: number }>> = [
  [
    { c: "var(--ing-nori)", top: 0, len: 3 },
    { c: "var(--ing-sake)", top: 2, len: 3 },
  ],
  [
    { c: "var(--ing-nori)", top: 1, len: 4 },
    { c: "var(--ing-sake)", top: 2, len: 2 },
    { c: "var(--ing-shiso)", top: 2, len: 3 },
  ],
  [{ c: "var(--ing-shiso)", top: 0, len: 2 }],
  [
    { c: "var(--ing-sake)", top: 1, len: 4 },
    { c: "var(--ing-shiso)", top: 3, len: 2 },
  ],
];

/** Picker tile: day tracks with a bar per person, one band where all line up. */
export function FreeTimesPreview() {
  return (
    <span class={styles.card}>
      <For each={DAYS}>
        {(bars, i) => (
          <span class={styles.day} data-all={i() === 1}>
            <For each={bars}>
              {(b, j) => (
                <span
                  class={styles.bar}
                  style={{
                    "--c": b.c,
                    "--top": b.top,
                    "--len": b.len,
                    "--lane": j(),
                  }}
                />
              )}
            </For>
          </span>
        )}
      </For>
    </span>
  );
}
