import { createMemo, createSignal, For, Show } from "solid-js";
import { POLL_OPTION_MAX, POLL_OPTIONS_MAX, randomId, type PollOption } from "@bentogether/shared";
import { personVars } from "../../../lib/identity";
import { WidgetFrame, type WidgetProps } from "../../frame/WidgetFrame";
import {
  AddField,
  changer,
  focusOnMount,
  Footer,
  parts,
  RemoveButton,
  createRows,
  TitleLine,
  useAuthor,
} from "../../frame/parts";
import styles from "./Poll.module.css";

/**
 * A question with options. Everyone votes, viewers too; your vote replaces
 * your last one (or adds to it when several picks are allowed). Bars fill
 * with each option's share, with a dot for each person who picked it.
 */
export function Poll(props: WidgetProps) {
  const s = () => props.session;
  const change = changer(props, "poll");
  const poll = createMemo(() => s().live(props.id, "poll"));
  const author = useAuthor(props);

  const options = () => poll()?.options ?? [];
  const votes = () => Object.values(poll()?.votes ?? {});
  const mine = createMemo(() => poll()?.votes[s().voter()]?.picks ?? []);
  const counts = createMemo(() => {
    const c = new Map<string, number>();
    for (const v of votes()) for (const p of v.picks) c.set(p, (c.get(p) ?? 0) + 1);
    return c;
  });
  const top = () => Math.max(1, ...counts().values());
  const voterCount = () => votes().length;

  function vote(optionId: string) {
    const picked = mine().includes(optionId);
    const picks = poll()?.multi
      ? picked
        ? mine().filter((p) => p !== optionId)
        : [...mine(), optionId]
      : picked
        ? []
        : [optionId];
    void change({ do: "vote", picks });
  }

  const rows = createRows(() => options());

  return (
    <WidgetFrame
      {...props}
      kind="poll"
      class={[parts.body, styles.poll]}
      color={s().color(props.id)}
      label={`Poll by ${author()}: ${s().listTitle(props.id) || "untitled"}, ${voterCount()} voted`}
      deleteLabel="Delete poll"
    >
      <TitleLine
        id={props.id}
        session={s()}
        readOnly={props.readOnly}
        placeholder={props.readOnly ? "Poll" : "Ask a question"}
        label="Poll question"
        onError={props.onError}
      />

      <ul class={[parts.scroll, styles.options]} aria-label="Options">
        <For each={rows.ids()}>
          {(optionId) => (
            <Show when={rows.get(optionId)}>
              {(o) => (
                <Option
                  option={o()}
                  count={counts().get(o().id) ?? 0}
                  share={(counts().get(o().id) ?? 0) / top()}
                  picked={mine().includes(o().id)}
                  multi={poll()?.multi ?? false}
                  voters={votes().filter((v) => v.picks.includes(o().id))}
                  readOnly={props.readOnly}
                  onVote={() => vote(o().id)}
                  onEdit={(text) => void change({ do: "editOption", optionId: o().id, text })}
                  onRemove={() => void change({ do: "removeOption", optionId: o().id })}
                  onEditing={(on) => s().setPresence({ action: on ? "typing" : null })}
                />
              )}
            </Show>
          )}
        </For>
        <Show when={options().length === 0}>
          <li class={parts.muted}>{props.readOnly ? "No options yet." : "Add the choices below."}</li>
        </Show>
      </ul>

      <Show when={!props.readOnly && options().length < POLL_OPTIONS_MAX}>
        <AddField
          session={s()}
          placeholder="Add an option"
          max={POLL_OPTION_MAX}
          onAdd={(text) => void change({ do: "addOption", optionId: randomId(12), text })}
        />
      </Show>

      <Footer
        id={props.id}
        session={s()}
        readOnly={props.readOnly}
        width={props.rect.w}
        author={author()}
        colorLabel="Poll color"
        onError={props.onError}
        info={
          <Show when={voterCount() > 0}>
            <span class={styles.count}>
              {voterCount()} {voterCount() === 1 ? "vote" : "votes"}
            </span>
          </Show>
        }
        tools={
          <>
            <button
              type="button"
              class={parts.chip}
              aria-pressed={poll()?.multi ? "true" : "false"}
              title="Let people pick more than one"
              onClick={() => void change({ do: "setMulti", multi: !poll()?.multi })}
            >
              Several
            </button>
            <Show when={voterCount() > 0}>
              <button
                type="button"
                class={parts.chip}
                aria-label="Clear votes"
                onClick={() => void change({ do: "clearVotes" })}
              >
                Clear
              </button>
            </Show>
          </>
        }
      />
    </WidgetFrame>
  );
}

function Option(props: {
  option: PollOption;
  count: number;
  share: number;
  picked: boolean;
  multi: boolean;
  voters: Array<{ name: string; hue: number }>;
  readOnly: boolean;
  onVote: () => void;
  onEdit: (text: string) => void;
  onRemove: () => void;
  onEditing: (on: boolean) => void;
}) {
  const [draft, setDraft] = createSignal<string | null>(null);

  function commit() {
    const d = draft();
    if (d === null) return;
    setDraft(null);
    props.onEditing(false);
    const text = d.trim();
    if (!text) props.onRemove();
    else if (text !== props.option.text) props.onEdit(text);
  }

  return (
    <li
      class={styles.row}
      data-row
      data-picked={props.picked}
      data-tools={!props.readOnly}
      style={{ "--share": props.share }}
    >
      <Show
        when={draft() !== null}
        fallback={
          <button
            type="button"
            role={props.multi ? "checkbox" : "radio"}
            aria-checked={props.picked ? "true" : "false"}
            class={styles.vote}
            onClick={() => props.onVote()}
          >
            <span class={styles.mark} data-multi={props.multi} aria-hidden="true" />
            <span class={styles.text}>{props.option.text}</span>
            <span class={styles.voters} aria-hidden="true">
              <For each={props.voters.slice(0, 5)} keyed={(v) => v.name}>
                {(v) => <span class={parts.dot} style={personVars(v().hue)} title={v().name} />}
              </For>
            </span>
            <span class={styles.n}>{props.count}</span>
          </button>
        }
      >
        <input
          ref={focusOnMount}
          class={[parts.plain, parts.editing, styles.editField]}
          value={draft()!}
          maxlength={POLL_OPTION_MAX}
          aria-label="Option text"
          onInput={(e) => void setDraft(e.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setDraft(null);
              props.onEditing(false);
            }
          }}
        />
      </Show>
      <Show when={!props.readOnly && draft() === null}>
        <span class={styles.rowTools}>
          <button
            type="button"
            class={[parts.icon, parts.onHover]}
            aria-label={`Edit ${props.option.text}`}
            onClick={() => {
              setDraft(props.option.text);
              props.onEditing(true);
            }}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M10.5 3.2l2.3 2.3M3.5 12.5l.6-2.7 7-7 2.1 2.1-7 7z" />
            </svg>
          </button>
          <RemoveButton label={`Remove ${props.option.text}`} onClick={props.onRemove} />
        </span>
      </Show>
    </li>
  );
}
