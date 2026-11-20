import { createSignal, For } from "solid-js";
import styles from "./toasts.module.css";

type Toast = { id: number; message: string; tone: "info" | "error" };

/** A tiny toast queue. `push` is safe to call from any handler. */
export function createToaster() {
  const [toasts, setToasts] = createSignal<Toast[]>([]);
  let next = 1;

  function push(message: string, tone: Toast["tone"] = "info") {
    const id = next++;
    setToasts((list) => [...list.filter((t) => t.message !== message), { id, message, tone }].slice(-3));
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 3600);
  }

  function Toasts() {
    return (
      <div class={styles.stack} role="status" aria-live="polite">
        <For each={toasts()} keyed={(t) => t.id}>
          {(t) => (
            <div class={styles.toast} data-tone={t().tone}>
              {t().message}
            </div>
          )}
        </For>
      </div>
    );
  }

  return { push, Toasts };
}
