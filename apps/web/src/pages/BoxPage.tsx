import { createEffect, createMemo, createSignal, Errored, Loading, Match, Show, Switch } from "solid-js";
import { Board } from "../board/Board";
import { Toolbar } from "../board/Toolbar";
import { AddWidget } from "../board/AddWidget";
import { FitToggle } from "../board/FitToggle";
import { NameTaken, openSession, PasswordRequired, type BoxSession } from "../board/session";
import { HomeLink, Lockup, Mark } from "../brand/Logo";
import { BoxNotFound, getBox, Outdated, OverCapacity, Unreachable } from "../lib/api";
import {
  loadDevice,
  nameFor,
  passwordFor,
  rememberName,
  rememberPassword,
  handOffName,
  saveHue,
  suggestName,
} from "../lib/identity";
import { NameField } from "../ui/NameField";
import { rememberBox } from "../lib/recent";
import { ownerTokenFor } from "../lib/owner";
import { viewingLabel, widgetsLabel } from "../lib/format";
import { navigate } from "../lib/router";
import { createToaster, type Toaster } from "../ui/toasts";
import { UNDO_MS } from "@bentogether/shared";
import { Splash } from "../ui/Splash";
import { LoadingLine } from "../ui/LoadingLine";
import styles from "./pages.module.css";

/**
 * A box, end to end:
 * - first time here, a join modal asks your name for this box (its title
 *   and who's viewing it come from an async memo under `<Loading>`);
 * - then the session is an async memo that resolves on the server's first
 *   `welcome`, so `<Loading>` covers the wait and nothing renders half a box;
 * - a missing box rejects either memo, and `<Errored>` shows it, with no
 *   error branches in the components.
 */
export function BoxPage(props: { id: string }) {
  // Writable derived signal (2.0): seeded from storage per box id, reset
  // when the id changes, and set locally when you join.
  const [name, setName] = createSignal(() => nameFor(props.id));
  // Same pattern for a password protected bento: kept for this tab only.
  const [password, setPassword] = createSignal(() => passwordFor(props.id));
  const { push, Toasts } = createToaster();

  function join(n: string, pw?: string) {
    rememberName(props.id, n);
    setName(n);
    if (pw !== undefined) {
      rememberPassword(props.id, pw);
      setPassword(pw);
    }
  }

  return (
    <>
      <Errored
        fallback={(err, reset) =>
          err() instanceof PasswordRequired ? (
            // Asked for (or got wrong) the password: ask again, then retry.
            <JoinGate
              id={props.id}
              needsPassword
              error={(err() as PasswordRequired).wrong ? "That password didn't work." : null}
              defaultName={name() ?? undefined}
              onJoin={(n, pw) => {
                join(n, pw);
                reset();
              }}
            />
          ) : err() instanceof NameTaken ? (
            // Someone here already has that name: ask for another, then retry.
            <JoinGate
              id={props.id}
              nameError={(err() as NameTaken).message}
              defaultName={name() ?? undefined}
              onJoin={(n) => {
                join(n);
                reset();
              }}
            />
          ) : (
            <BoxError error={err()} onRetry={reset} />
          )
        }
      >
        <Show when={name()} fallback={<JoinGate id={props.id} onJoin={join} />}>
          {(n) => (
            <BoxRoom
              id={props.id}
              name={n()}
              password={password()}
              onRename={(next) => {
                rememberName(props.id, next);
                setName(next);
              }}
              toast={push}
            />
          )}
        </Show>
      </Errored>
      <Toasts />
    </>
  );
}

function BoxRoom(props: {
  id: string;
  name: string;
  password: string | null;
  onRename: (name: string) => void;
  toast: Toaster;
}) {
  // The socket's hello reads these on every (re)connect; the device is read
  // fresh, so a color changed in Settings survives a reconnect.
  const session = createMemo(() =>
    openSession(props.id, () => ({
      ...loadDevice(),
      name: props.name,
      ownerToken: ownerTokenFor(props.id),
      password: props.password ?? undefined,
    })),
  );
  return (
    <Loading fallback={<SettingTable />}>
      <BoxView
        session={session()}
        onRename={(n) => {
          props.onRename(n);
          session().rename(n);
        }}
        toast={props.toast}
      />
    </Loading>
  );
}

function BoxView(props: { session: BoxSession; onRename: (name: string) => void; toast: Toaster }) {
  // Compute extracts plain values; apply only does the side effect. Reading
  // the store proxy inside apply is what STRICT_READ_UNTRACKED flags.
  createEffect(
    () => {
      const meta = props.session.server.meta;
      return meta ? { id: meta.id, title: meta.title, createdAt: meta.createdAt } : null;
    },
    (box) => {
      if (!box) return;
      document.title = `${box.title} · benTogether`;
      rememberBox(box);
    },
  );
  return (
    <main class={styles.box}>
      <Toolbar session={props.session} onRename={props.onRename} toast={props.toast} />
      <Show when={props.session.server.notice}>
        {(notice) => (
          <div class={styles.notice} role="alert">
            {/* Sentences sit on one line when they fit; otherwise each wraps whole. */}
            <p>
              {notice()
                .split("\n")
                .flatMap((line, i) => (i ? [" ", <span>{line}</span>] : [<span>{line}</span>]))}
            </p>
            <Show
              when={props.session.server.deleted}
              fallback={
                <button type="button" class="btn" onClick={() => location.reload()}>
                  Try again
                </button>
              }
            >
              <button type="button" class="btn" onClick={() => navigate("/")}>
                Back home
              </button>
            </Show>
          </div>
        )}
      </Show>
      <Board
        session={props.session}
        onError={(m) => props.toast(m, "error")}
        onNotice={(m) => props.toast(m, "info")}
        onDeleted={(what, undo) =>
          props.toast(`${what[0]!.toUpperCase()}${what.slice(1)} deleted.`, "info", {
            label: "Undo",
            // A little under the server's window, so Undo never shows when it can't work.
            ms: UNDO_MS - 2000,
            run: () => void undo().catch((err: Error) => props.toast(err.message, "error")),
          })
        }
      />
      <Show when={props.session.canEdit()}>
        <AddWidget session={props.session} toast={props.toast} />
      </Show>
      <FitToggle />
    </main>
  );
}

/** "Pull up a chair": the box's name and who's there, then your name. */
function JoinGate(props: {
  id: string;
  onJoin: (name: string, password?: string) => void;
  /** Known up front from an earlier refusal; otherwise read from the bento's access. */
  needsPassword?: boolean;
  error?: string | null;
  /** The name was refused (someone here has it); you're already past any password. */
  nameError?: string | undefined;
  defaultName?: string | undefined;
}) {
  const info = createMemo(() => getBox(props.id));
  const [hue, setHue] = createSignal(loadDevice().hue);
  const suggested = props.defaultName ?? suggestName();
  // Creators skip the password: their owner token gets them in.
  const askPassword = createMemo(
    () =>
      !props.nameError &&
      !ownerTokenFor(props.id) &&
      (props.needsPassword || info().access?.mode === "password"),
  );
  return (
    <main class={styles.page}>
      <Splash label="Join this bento">
        <div class={styles.modalHead}>
          <a
            href="/"
            class={styles.homeLink}
            aria-label="benTogether home"
            onClick={(e) => {
              e.preventDefault();
              // Carry over whatever name is in the field, so home knows you.
              const typed = e.currentTarget
                .closest("section")
                ?.querySelector<HTMLInputElement>('input[name="name"]');
              handOffName(typed?.value || suggested);
              navigate("/");
            }}
          >
            <Lockup />
          </a>
        </div>
        <Loading fallback={<p class={styles.joinTitle}>Finding the bento…</p>}>
          <p class={styles.joinKicker}>You're invited to</p>
          <h1 class={styles.joinTitle}>{info().title}</h1>
          <p class={styles.joinMeta}>
            {viewingLabel(info().people)} · {widgetsLabel(info().widgetCount)}
          </p>
        </Loading>
        <form
          class={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            const n = data.get("name")?.toString().trim();
            const pw = data.get("password")?.toString();
            props.onJoin(n || suggested, askPassword() ? (pw ?? "") : undefined);
          }}
        >
          <NameField
            defaultName={suggested}
            hue={hue()}
            onHue={(h) => {
              setHue(h);
              saveHue(h);
            }}
            autofocus={!props.error}
            error={props.nameError}
          />
          <Loading>
            <Show when={askPassword()}>
              <label class={styles.field}>
                <span class={styles.fieldLabel}>Password</span>
                <input
                  type="password"
                  name="password"
                  class={["field", styles.input]}
                  autocomplete="current-password"
                  aria-label="Password"
                  aria-invalid={props.error ? "true" : "false"}
                  autofocus={!!props.error}
                  required
                />
                <Show when={props.error}>
                  <span class={styles.fieldError} role="alert">
                    {props.error}
                  </span>
                </Show>
              </label>
            </Show>
          </Loading>
          <button type="submit" class={["btn btn-primary", styles.submit]}>
            Join the bento
          </button>
        </form>
      </Splash>
    </main>
  );
}

function SettingTable() {
  return (
    <div class={styles.center} role="status">
      <HomeLink class={styles.loadingMark}>
        <Mark size={44} />
      </HomeLink>
      <p>
        <LoadingLine />
      </p>
    </div>
  );
}

function BoxError(props: { error: unknown; onRetry: () => void }) {
  const missing = () => props.error instanceof BoxNotFound;
  // Capacity and reachability pass on their own; worth another try later.
  const transient = () => props.error instanceof OverCapacity || props.error instanceof Unreachable;
  const outdated = () => props.error instanceof Outdated;
  const heading = () =>
    missing()
      ? "Nothing in this bento."
      : outdated()
        ? "There's a new version."
        : props.error instanceof OverCapacity
          ? "We're full for today."
          : props.error instanceof Unreachable
            ? "Can't reach the bento."
            : "Something went wrong.";
  // Names the problem in the tab and history, not just "benTogether".
  createEffect(
    () => `${missing() ? "Bento not found" : heading().replace(/\.$/, "")} · benTogether`,
    (title) => {
      document.title = title;
    },
  );
  return (
    <div class={styles.center}>
      <HomeLink>
        <Mark size={44} />
      </HomeLink>
      <h1 class={styles.heading}>{heading()}</h1>
      <p>
        {missing()
          ? "This bento doesn't exist, or it was cleared away."
          : String((props.error as Error)?.message ?? props.error)}
      </p>
      <Switch
        fallback={
          <button type="button" class="btn btn-primary" onClick={() => navigate("/")}>
            Start a new bento
          </button>
        }
      >
        <Match when={outdated()}>
          <button type="button" class="btn btn-primary" onClick={() => location.reload()}>
            Reload
          </button>
        </Match>
        <Match when={transient()}>
          <button type="button" class="btn btn-primary" onClick={() => props.onRetry()}>
            Try again
          </button>
        </Match>
      </Switch>
    </div>
  );
}
