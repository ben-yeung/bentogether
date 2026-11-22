import { createSignal, For, Show } from "solid-js";
import styles from "./toasts.module.css";

/** A button on a toast, say "Undo". The toast stays up for `ms`. */
export type ToastAction = { label: string; run: () => void; ms?: number };

type Toast = { id: number; message: string; tone: "info" | "error"; action?: ToastAction };

/** A tiny toast queue. `push` is safe to call from any handler. */
export function createToaster() {
  const [toasts, setToasts] = createSignal<Toast[]>([]);
  let next = 1;

  const dismiss = (id: number) => setToasts((list) => list.filter((t) => t.id !== id));

  function push(message: string, tone: Toast["tone"] = "info", action?: ToastAction) {
    const id = next++;
    setToasts((list) =>
      [
        ...list.filter((t) => t.message !== message),
        { id, message, tone, ...(action ? { action } : {}) },
      ].slice(-3),
    );
    setTimeout(() => dismiss(id), action?.ms ?? 3600);
  }

  function Toasts() {
    return (
      <div class={styles.stack} role="status" aria-live="polite">
        <For each={toasts()} keyed={(t) => t.id}>
          {(t) => (
            <div class={styles.toast} data-tone={t().tone} data-action={t().action ? "" : undefined}>
              {t().message}
              <Show when={t().action}>
                {(a) => (
                  <button
                    type="button"
                    class={styles.action}
                    onClick={() => {
                      dismiss(t().id);
                      a().run();
                    }}
                  >
                    {a().label}
                  </button>
                )}
              </Show>
            </div>
          )}
        </For>
      </div>
    );
  }

  return { push, Toasts };
}

export type Toaster = ReturnType<typeof createToaster>["push"];
