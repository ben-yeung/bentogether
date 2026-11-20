import { createMemo, createSignal, For, Show } from "solid-js";
import { NAME_MAX } from "@bentogether/shared";
import { personVars } from "../lib/identity";
import { setThemePref, themePref, type ThemePref } from "../lib/theme";
import { Dialog } from "../ui/Dialog";
import { Switch } from "../ui/Switch";
import type { BoxSession } from "./session";
import styles from "./SettingsDialog.module.css";

const THEMES: Array<{ value: ThemePref; label: string }> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/**
 * Settings: your name here, this bento's (for everyone; the creator changes
 * them, enforced by the server) and your own appearance (light/dark, kept on
 * this device).
 */
export function SettingsDialog(props: {
  open: boolean;
  onClose: () => void;
  session: BoxSession;
  onRename: (name: string) => void;
  /** Asks to clear the bento; the confirmation is its own dialog. */
  onClear: () => void;
  toast: (message: string, tone?: "info" | "error") => void;
}) {
  const s = () => props.session;
  const fail = (err: Error) => props.toast(err.message, "error");
  const me = createMemo(() => s().peers[s().server.sid]);

  // Saved when you leave the field or press Enter; an empty name reverts.
  function commitName(input: HTMLInputElement) {
    const next = input.value.trim().slice(0, NAME_MAX);
    const current = me()?.name ?? "";
    if (!next) input.value = current;
    else if (next !== current) props.onRename(next);
  }

  return (
    <Dialog open={props.open} onClose={props.onClose} label="Bento settings" size="sm">
      <div class={styles.settings}>
        <header class={styles.head}>
          <h2 class={styles.title}>Settings</h2>
        </header>
        <section class={styles.section}>
          <label class={styles.sectionLabel} for="settings-name">
            Your name <span class={styles.sectionNote}>(just for this bento)</span>
          </label>
          <span class={styles.nameRow}>
            <span class={styles.nameDot} style={personVars(me()?.hue ?? 0)} aria-hidden="true" />
            <input
              id="settings-name"
              class={["field", styles.nameInput]}
              value={me()?.name ?? ""}
              maxlength={NAME_MAX}
              autocomplete="nickname"
              onChange={(e) => commitName(e.currentTarget)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitName(e.currentTarget);
                }
              }}
            />
          </span>
        </section>
        <section class={styles.section} aria-label="This bento">
          <h3 class={styles.sectionLabel}>
            This bento <span class={styles.sectionNote}>(for everyone)</span>
          </h3>
          <Show when={!s().isOwner()}>
            <p class={styles.note}>Only the creator can change these.</p>
          </Show>
          <Switch
            label="Live cursors"
            hint="See where everyone is pointing."
            checked={s().options().cursors}
            disabled={!s().isOwner()}
            onChange={(v) => s().setOptions({ cursors: v }).catch(fail)}
          />
          <Switch
            label="Auto-pack"
            hint="Fill gaps automatically, or place notes freely."
            checked={s().options().autoPack}
            disabled={!s().isOwner()}
            onChange={(v) => s().setOptions({ autoPack: v }).catch(fail)}
          />
        </section>
        <section class={styles.section} aria-labelledby="appearance-heading">
          <h3 id="appearance-heading" class={styles.sectionLabel}>
            Appearance <span class={styles.sectionNote}>(just for you)</span>
          </h3>
          <div class={styles.segmented} role="radiogroup" aria-label="Theme">
            <For each={THEMES}>
              {(t) => (
                <button
                  type="button"
                  role="radio"
                  class={styles.segment}
                  aria-checked={themePref() === t.value ? "true" : "false"}
                  onClick={() => setThemePref(t.value)}
                >
                  {t.label}
                </button>
              )}
            </For>
          </div>
        </section>
        <section class={styles.danger} aria-label="Clear bento">
          <button
            type="button"
            class={["btn", styles.dangerBtn]}
            disabled={!s().isOwner() || s().ids().length === 0}
            onClick={() => props.onClear()}
          >
            Clear Bento
          </button>
          <p class={styles.note}>
            {!s().isOwner()
              ? "Only the creator can clear this bento."
              : s().ids().length === 0
                ? "This bento is already empty."
                : "Removes every widget, for everyone."}
          </p>
        </section>
      </div>
    </Dialog>
  );
}

/**
 * The step before clearing: says what will go and that it can't be undone.
 * "Keep it" has focus, so Enter doesn't clear by accident.
 */
export function ClearBentoDialog(props: {
  open: boolean;
  onClose: () => void;
  session: BoxSession;
  toast: (message: string, tone?: "info" | "error") => void;
}) {
  const s = () => props.session;
  const [busy, setBusy] = createSignal(false);
  const count = () => s().ids().length;

  async function clear() {
    setBusy(true);
    try {
      await s().clearBento();
      props.toast("Bento cleared.");
      props.onClose();
    } catch (err) {
      props.toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={props.open} onClose={props.onClose} label="Clear this bento?" size="sm">
      <div class={styles.settings}>
        <header class={styles.head}>
          <h2 class={styles.title}>Clear this bento?</h2>
        </header>
        <p class={styles.confirmText}>
          This removes all {count()} {count() === 1 ? "widget" : "widgets"} and everything in them, for
          everyone here. It can't be undone.
        </p>
        <div class={styles.actions}>
          <button type="button" class="btn btn-ghost" autofocus onClick={() => props.onClose()}>
            Keep it
          </button>
          <button
            type="button"
            class={["btn", styles.confirmBtn]}
            disabled={busy()}
            onClick={() => void clear()}
          >
            {busy() ? "Clearing…" : "Clear Bento"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
