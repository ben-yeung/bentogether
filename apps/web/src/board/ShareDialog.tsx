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
  /** "Password protected" picked, but no password saved: the bento is still open. */
  const pendingPassword = () => mode() === "password" && s().access().mode !== "password";

  /** The clipboard said no: the link shows as selected text instead. */
  const [manual, setManual] = createSignal(false);

  function done() {
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link());
      done();
    } catch {
      setManual(true);
    }
  }

  /** Shown when copying failed: selected, and one older way of copying tried. */
  function selectLink(el: HTMLInputElement) {
    setTimeout(() => {
      el.focus();
      el.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch {
        // Not allowed here either.
      }
      if (ok) {
        done();
        // Copied after all: the plain field isn't needed.
        setManual(false);
      } else props.toast("Couldn't copy by itself. The link is selected, ready to copy.", "error");
    }, 0);
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

      {/* The whole row copies: the link text and the icon are one button. */}
      <button
        type="button"
        class={styles.linkRow}
        onClick={() => void copy()}
        aria-label={copied() ? "Link copied" : `Copy link: ${link()}`}
        title={copied() ? "Copied" : "Copy link"}
        autofocus
      >
        <span class={styles.linkText}>{link()}</span>
        <span class={["icon-btn", styles.copyIcon]} data-copied={copied() || undefined} aria-hidden="true">
          <Show
            when={copied()}
            fallback={
              <svg viewBox="0 0 20 20">
                <rect x="7" y="7" width="9.5" height="9.5" rx="2" />
                <path d="M13 7V5.5A2 2 0 0 0 11 3.5H5.5a2 2 0 0 0-2 2V11a2 2 0 0 0 2 2H7" />
              </svg>
            }
          >
            <svg viewBox="0 0 20 20">
              <path d="M4.5 10.5 8 14l7.5-8" />
            </svg>
          </Show>
        </span>
      </button>
      <Show when={manual()}>
        <input
          ref={selectLink}
          class={["field", styles.linkManual]}
          readonly
          value={link()}
          aria-label="Bento link"
          onFocus={(e) => e.currentTarget.select()}
        />
      </Show>
      <span class="visually-hidden" role="status">
        {copied() ? "Link copied" : ""}
      </span>

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
          Bento privacy
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
          <Select
            class={["field-select", styles.selectPlain]}
            label="Who can join"
            value={mode()}
            options={MODE_OPTIONS}
            disabled={!owner()}
            onChange={chooseMode}
          />
          <span class={styles.accessStatus} data-pending={pendingPassword() || undefined}>
            {mode() === "password"
              ? pendingPassword()
                ? "Not on yet: set a password below."
                : "New visitors need the password."
              : "No password needed."}
          </span>
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
            <span class={styles.accessHint}>Default permissions assigned when they join.</span>
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
