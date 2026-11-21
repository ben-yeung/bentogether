import { createMemo, createSignal, For, Show } from "solid-js";
import { PASSWORD_MAX, PASSWORD_MIN, type AssignableRole, type Peer } from "@bentogether/shared";
import { personVars } from "../lib/identity";
import { Dialog } from "../ui/Dialog";
import { Select } from "../ui/Select";
import type { BoxSession } from "./session";
import styles from "./ShareDialog.module.css";

const ROLE_LABEL: Record<AssignableRole, string> = { editor: "Can edit", viewer: "Can view" };
const ROLE_OPTIONS = [
  { value: "editor", label: ROLE_LABEL.editor },
  { value: "viewer", label: ROLE_LABEL.viewer },
] as const satisfies readonly { value: AssignableRole; label: string }[];
const MODE_OPTIONS = [
  { value: "link", label: "Anyone with the link" },
  { value: "password", label: "Password protected" },
] as const;

/**
 * Share, Drive-style: the link to copy, who's viewing the bento and what each of
 * them can do, what new visitors can do, and who can get in at all (anyone
 * with the link, or only with a password). Everyone can open it; only the
 * creator can change anything, and the server enforces that.
 */
export function ShareDialog(props: {
  open: boolean;
  onClose: () => void;
  session: BoxSession;
  toast: (message: string, tone?: "info" | "error") => void;
}) {
  return (
    <Dialog open={props.open} onClose={props.onClose} label="Share this bento">
      <ShareBody {...props} />
    </Dialog>
  );
}

function ShareBody(props: {
  onClose: () => void;
  session: BoxSession;
  toast: (message: string, tone?: "info" | "error") => void;
}) {
  const s = () => props.session;
  const owner = () => s().isOwner();
  const link = () => `${location.origin}/b/${s().server.meta?.id ?? ""}`;

  const people = createMemo(() =>
    Object.values(s().peers).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)),
  );

  // Writable derived (2.0): follows the bento's mode, and the owner can
  // switch it locally to "password" before a password has been saved.
  const [mode, setMode] = createSignal(() => s().access().mode);
  const [password, setPassword] = createSignal("");
  const [copied, setCopied] = createSignal(false);

  const fail = (err: Error) => props.toast(err.message, "error");

  async function copy() {
    try {
      await navigator.clipboard.writeText(link());
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      props.toast("Couldn't copy. Select the link and copy it instead.", "error");
    }
  }

  function chooseMode(next: "link" | "password") {
    setMode(next);
    setPassword("");
    // Password mode needs a password first; that's saved from its own field.
    if (next === "link" && s().access().mode !== "link") s().setAccess({ mode: "link" }).catch(fail);
  }

  function savePassword(e: SubmitEvent) {
    e.preventDefault();
    const pw = password();
    if (pw.length < PASSWORD_MIN) return;
    s()
      .setAccess({ mode: "password", password: pw })
      .then(() => {
        setPassword("");
        props.toast("Password saved. New visitors will need it to join.");
      })
      .catch(fail);
  }

  return (
    <div class={styles.share}>
      <header class={styles.head}>
        <h2 class={styles.title}>
          Share <span class={styles.boxName}>“{s().title()}”</span>
        </h2>
        <Show when={!owner()}>
          <p class={styles.note}>Ask the bento's owner to invite more people.</p>
        </Show>
      </header>

      <div class={styles.linkRow}>
        <input
          class={["field", styles.linkInput]}
          value={link()}
          readonly
          aria-label="Link to this bento"
          onFocus={(e) => e.currentTarget.select()}
        />
        <button type="button" class="btn btn-primary" onClick={() => void copy()} autofocus>
          {copied() ? "Copied" : "Copy link"}
        </button>
      </div>

      <section class={styles.section} aria-labelledby="share-people">
        <h3 id="share-people" class={styles.sectionLabel}>
          Viewing the bento
        </h3>
        <ul class={styles.people}>
          <For each={people()} keyed={(p) => p.sid}>
            {(p) => (
              <li class={styles.person}>
                <span class={styles.face} style={personVars(p().hue)} aria-hidden="true">
                  {p().name.slice(0, 1)}
                </span>
                <span class={styles.personName}>
                  {p().name}
                  <Show when={s().isMine(p().sid)}>
                    <span class={styles.you}> (you)</span>
                  </Show>
                </span>
                <Show
                  when={owner() && p().role !== "owner"}
                  fallback={<span class={styles.roleText}>{roleText(p())}</span>}
                >
                  <Select
                    class={["field-select", styles.select]}
                    label={`What ${p().name} can do`}
                    align="end"
                    value={p().role as AssignableRole}
                    options={ROLE_OPTIONS}
                    onChange={(role) => s().setRole(p().sid, role).catch(fail)}
                  />
                </Show>
              </li>
            )}
          </For>
        </ul>
      </section>

      <section class={styles.section} aria-labelledby="share-access">
        <h3 id="share-access" class={styles.sectionLabel}>
          General access
        </h3>
        <div class={styles.accessRow}>
          <span class={styles.accessIcon} data-mode={mode()} aria-hidden="true">
            <Show
              when={mode() === "password"}
              fallback={
                <svg viewBox="0 0 20 20">
                  <path d="M8.5 11.5a3.5 3.5 0 0 0 5 0l2.5-2.5a3.5 3.5 0 0 0-5-5L10 5M11.5 8.5a3.5 3.5 0 0 0-5 0L4 11a3.5 3.5 0 0 0 5 5l1-1" />
                </svg>
              }
            >
              <svg viewBox="0 0 20 20">
                <rect x="4" y="9" width="12" height="8" rx="2" />
                <path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
              </svg>
            </Show>
          </span>
          <div class={styles.accessText}>
            <Select
              class={["field-select", styles.selectPlain]}
              label="Who can join"
              value={mode()}
              options={MODE_OPTIONS}
              disabled={!owner()}
              onChange={chooseMode}
            />
            <span class={styles.accessHint}>
              {mode() === "password"
                ? s().access().mode === "password"
                  ? "A password is required for new visitors."
                  : "Set a password to turn this on."
                : "Anyone with the link can join."}
            </span>
          </div>
        </div>

        <Show when={owner() && mode() === "password"}>
          <form class={styles.passwordRow} onSubmit={savePassword}>
            <input
              type="password"
              class={["field", styles.passwordInput]}
              placeholder={s().access().mode === "password" ? "New password" : "Password"}
              aria-label={s().access().mode === "password" ? "New password" : "Password"}
              minlength={PASSWORD_MIN}
              maxlength={PASSWORD_MAX}
              autocomplete="new-password"
              value={password()}
              onInput={(e) => setPassword(e.currentTarget.value)}
            />
            <button type="submit" class="btn" disabled={password().length < PASSWORD_MIN}>
              {s().access().mode === "password" ? "Change" : "Set password"}
            </button>
          </form>
        </Show>

        <div class={styles.defaultRow}>
          <span>
            New visitors
            <span class={styles.accessHint}>What people get when they first join.</span>
          </span>
          <Select
            class={["field-select", styles.select]}
            label="What new visitors can do"
            align="end"
            value={s().access().defaultRole}
            options={ROLE_OPTIONS}
            disabled={!owner()}
            onChange={(defaultRole) => s().setAccess({ defaultRole }).catch(fail)}
          />
        </div>
      </section>
    </div>
  );
}

function rank(p: Peer) {
  return p.role === "owner" ? 0 : p.role === "editor" ? 1 : 2;
}

function roleText(p: Peer) {
  return p.role === "owner" ? "Owner" : ROLE_LABEL[p.role];
}
