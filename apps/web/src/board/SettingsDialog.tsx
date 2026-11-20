import { For, Show } from "solid-js";
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
 * Settings: this bento's (for everyone; the creator changes them, enforced by
 * the server) and your own appearance (light/dark, kept on this device).
 */
export function SettingsDialog(props: {
  open: boolean;
  onClose: () => void;
  session: BoxSession;
  toast: (message: string, tone?: "info" | "error") => void;
}) {
  const s = () => props.session;
  const fail = (err: Error) => props.toast(err.message, "error");
  return (
    <Dialog open={props.open} onClose={props.onClose} label="Bento settings" size="sm">
      <div class={styles.settings}>
        <header class={styles.head}>
          <h2 class={styles.title}>Settings</h2>
        </header>
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
      </div>
    </Dialog>
  );
}
