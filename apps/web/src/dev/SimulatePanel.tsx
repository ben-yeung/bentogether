import { render } from "@solidjs/web";
import { createMemo, createSignal, For, Show } from "solid-js";
import { REALTIME_URL } from "../lib/config";
import { matchRoute, path } from "../lib/router";
import styles from "./SimulatePanel.module.css";

/**
 * Dev-only panel for stepping through what people see when Cloudflare's free
 * quota runs out. It flips the local Worker's `/__dev/simulate` switch (see
 * apps/realtime/src/dev.ts), so the real error paths run end to end. Loaded
 * from main.tsx only under `import.meta.env.DEV`, so it never ships.
 */
type Mode = "off" | "over_capacity" | "unreachable";

const MODES: { mode: Mode; label: string; hint: string }[] = [
  { mode: "off", label: "Normal", hint: "Everything works." },
  {
    mode: "over_capacity",
    label: "Over capacity",
    hint: "Durable Object quota used up: API returns 503, sockets close with 4503.",
  },
  {
    mode: "unreachable",
    label: "Unreachable",
    hint: "Worker's own daily limit (error 1027): no CORS, sockets fail. Opening a bento gives up after 15s.",
  },
];

function SimulatePanel() {
  const [open, setOpen] = createSignal(false);
  const [mode, setMode] = createSignal<Mode | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const boxId = createMemo(() => {
    const r = matchRoute(path());
    return r.name === "box" ? r.id : null;
  });

  async function call(pathname: string, method: "GET" | "POST") {
    try {
      const res = await fetch(`${REALTIME_URL}${pathname}`, { method });
      if (!res.ok) throw new Error(`${res.status}`);
      setMode(((await res.json()) as { mode: Mode }).mode);
      setError(null);
    } catch (err) {
      setError(`Couldn't reach the local Worker's /__dev (${(err as Error).message}).`);
    }
  }

  void call("/__dev/simulate", "GET");

  return (
    <div class={styles.panel} data-mode={mode() ?? "off"}>
      <Show
        when={open()}
        fallback={
          <button type="button" class={styles.toggle} onClick={() => setOpen(true)}>
            Simulate{mode() && mode() !== "off" ? `: ${MODES.find((m) => m.mode === mode())?.label}` : ""}
          </button>
        }
      >
        <div class={styles.card} role="dialog" aria-label="Simulate Cloudflare limits">
          <div class={styles.head}>
            <strong>Simulate Cloudflare limits</strong>
            <button type="button" class={styles.close} aria-label="Close" onClick={() => setOpen(false)}>
              ×
            </button>
          </div>
          <fieldset class={styles.modes}>
            <legend class={styles.legend}>New requests</legend>
            <For each={MODES}>
              {(m) => (
                <label class={styles.mode}>
                  <input
                    type="radio"
                    name="simulate-mode"
                    checked={mode() === m.mode}
                    onChange={() => void call(`/__dev/simulate?mode=${m.mode}`, "POST")}
                  />
                  <span>
                    <span class={styles.label}>{m.label}</span>
                    <span class={styles.hint}>{m.hint}</span>
                  </span>
                </label>
              )}
            </For>
          </fieldset>
          <Show when={boxId()}>
            {(id) => (
              <button
                type="button"
                class="btn"
                onClick={() => void call(`/__dev/boxes/${id()}/cut-off`, "POST")}
              >
                Run out mid-session
              </button>
            )}
          </Show>
          <p class={styles.note}>
            Modes affect the next request: create a bento, open one, or press Try again. "Run out mid-session"
            ends this bento's live sessions and switches to Over capacity.
          </p>
          <Show when={error()}>
            <p class={styles.error}>{error()}</p>
          </Show>
        </div>
      </Show>
    </div>
  );
}

export function mountSimulatePanel() {
  const host = document.createElement("div");
  document.body.append(host);
  render(() => <SimulatePanel />, host);
}
