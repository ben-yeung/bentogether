import { createMemo, createSignal, For, Show } from "solid-js";
import { NAME_MAX, TITLE_MAX } from "@bentogether/shared";
import { Lockup } from "../brand/Logo";
import { personVars } from "../lib/identity";
import { viewingLabel } from "../lib/format";
import { navigate } from "../lib/router";
import type { BoxSession } from "./session";
import { ShareDialog } from "./ShareDialog";
import { SettingsDialog } from "./SettingsDialog";
import styles from "./Toolbar.module.css";

const STATUS_COPY = {
  connecting: "Setting the table…",
  reconnecting: "Lost the connection. Reconnecting…",
  closed: "Disconnected",
  open: "",
} as const;

export function Toolbar(props: {
  session: BoxSession;
  onRename: (name: string) => void;
  toast: (message: string, tone?: "info" | "error") => void;
}) {
  const s = () => props.session;
  const people = createMemo(() => Object.values(s().peers));
  const me = createMemo(() => s().peers[s().server.sid]);

  const [editingName, setEditingName] = createSignal(false);
  const [editingTitle, setEditingTitle] = createSignal(false);
  const [sharing, setSharing] = createSignal(false);
  const [settings, setSettings] = createSignal(false);

  return (
    <header class={styles.bar}>
      <a
        href="/"
        class={styles.home}
        onClick={(e) => {
          e.preventDefault();
          navigate("/");
        }}
      >
        <Lockup />
      </a>

      <div class={styles.title}>
        <Show
          when={editingTitle()}
          fallback={
            <Show when={s().isOwner()} fallback={<h1 class={styles.titleText}>{s().title()}</h1>}>
              <h1 class={styles.titleText}>
                <button
                  type="button"
                  class={styles.titleBtn}
                  title="Rename this bento"
                  aria-label={`Rename bento: ${s().title()}`}
                  onClick={() => setEditingTitle(true)}
                >
                  <span class={styles.titleLabel}>{s().title()}</span>
                  <svg class={styles.pencil} viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M10.5 2.5l3 3L6 13H3v-3z" />
                  </svg>
                </button>
              </h1>
            </Show>
          }
        >
          <form
            class={styles.titleForm}
            onSubmit={(e) => {
              e.preventDefault();
              const next = new FormData(e.currentTarget).get("title")?.toString().trim() ?? "";
              setEditingTitle(false);
              if (!next || next === s().title()) return;
              s()
                .retitle(next.slice(0, TITLE_MAX))
                .catch((err: Error) => props.toast(err.message, "error"));
            }}
          >
            {/* Grows and shrinks with the text: a hidden copy of the value
                shares the grid cell and sets the width. */}
            <span class={styles.autosize} data-value={s().title()}>
              <input
                name="title"
                class={["field", styles.titleInput]}
                defaultValue={s().title()}
                maxlength={TITLE_MAX}
                size={1}
                aria-label="Bento name"
                ref={(el) => queueMicrotask(() => el.select())}
                onInput={(e) => (e.currentTarget.parentElement!.dataset.value = e.currentTarget.value)}
                onBlur={(e) => e.currentTarget.form?.requestSubmit()}
                onKeyDown={(e) => e.key === "Escape" && setEditingTitle(false)}
              />
            </span>
          </form>
        </Show>
        <Show when={s().creator()}>
          {(c) => (
            <span class={styles.byline}>
              by
              <span class={styles.creator} style={personVars(c().hue)}>
                {c().name}
              </span>
            </span>
          )}
        </Show>
        <Show when={STATUS_COPY[s().server.status]}>
          {(copy) => (
            <span class={styles.status} data-status={s().server.status}>
              {copy()}
            </span>
          )}
        </Show>
      </div>

      <div class={styles.people} aria-label={viewingLabel(people().length, { includesYou: true })}>
        <ul class={styles.faces}>
          <For each={people()} keyed={(p) => p.sid}>
            {(p) => (
              <li
                class={styles.face}
                style={personVars(p().hue)}
                title={s().isMine(p().sid) ? `${p().name} (you)` : p().name}
              >
                {p().name.slice(0, 1)}
              </li>
            )}
          </For>
        </ul>
        <span class={styles.count}>{viewingLabel(people().length, { includesYou: true })}</span>
      </div>

      <Show
        when={editingName()}
        fallback={
          <button
            type="button"
            class="btn btn-ghost"
            onClick={() => setEditingName(true)}
            aria-label="Change your name"
          >
            <span class={styles.dot} style={personVars(me()?.hue ?? 0)} />
            {me()?.name ?? "you"}
          </button>
        }
      >
        <form
          class={styles.nameForm}
          onSubmit={(e) => {
            e.preventDefault();
            const value = new FormData(e.currentTarget).get("name")?.toString().trim() ?? "";
            if (value) props.onRename(value.slice(0, NAME_MAX));
            setEditingName(false);
          }}
        >
          <input
            name="name"
            class={["field", styles.nameInput]}
            defaultValue={me()?.name ?? ""}
            maxlength={NAME_MAX}
            aria-label="Your name"
            ref={(el) => queueMicrotask(() => el.select())}
            onBlur={(e) => e.currentTarget.form?.requestSubmit()}
            onKeyDown={(e) => e.key === "Escape" && setEditingName(false)}
          />
        </form>
      </Show>

      <Show when={!s().canEdit() && s().server.status === "open"}>
        <span class={styles.viewOnly} title="The creator gave you view access">
          View only
        </span>
      </Show>
      <button type="button" class="btn" onClick={() => setSharing(true)}>
        Share
      </button>
      <button
        type="button"
        class={["icon-btn", styles.settingsBtn]}
        aria-label="Bento settings"
        title="Settings"
        onClick={() => setSettings(true)}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M3 6h9M15 6h2M3 14h3M9 14h8" />
          <circle cx="13.5" cy="6" r="1.8" />
          <circle cx="7.5" cy="14" r="1.8" />
        </svg>
      </button>
      <SettingsDialog
        open={settings()}
        onClose={() => setSettings(false)}
        session={s()}
        toast={props.toast}
      />
      <ShareDialog open={sharing()} onClose={() => setSharing(false)} session={s()} toast={props.toast} />
    </header>
  );
}
