import { createMemo, createSignal, For, Show } from "solid-js";
import { IDEA_TEXT_MAX, IDEAS_MAX, randomId } from "@bentogether/shared";
import { personVars } from "../../../lib/identity";
import { WidgetFrame, type WidgetProps } from "../../frame/WidgetFrame";
import {
  AddField,
  changer,
  EditableText,
  Footer,
  parts,
  RemoveButton,
  createRows,
  TitleLine,
  shownName,
  useAuthor,
} from "../../frame/parts";
import styles from "./Ideas.module.css";

/**
 * Ideas anyone can add, and everyone (viewers too) can upvote once each.
 * The most wanted float to the top.
 */
export function Ideas(props: WidgetProps) {
  const s = () => props.session;
  const change = changer(props, "ideas");
  const board = createMemo(() => s().live(props.id, "ideas"));
  const author = useAuthor(props);
  const me = () => s().voter();

  /** Most votes first; ties keep the order they were added. */
  const ranked = createMemo(() =>
    [...(board()?.ideas ?? [])].sort((a, b) => b.votes.length - a.votes.length || a.at - b.at),
  );

  /**
   * While your pointer or focus is in the list, rows hold still: voting
   * mustn't slide another idea under your next click. They re-sort when you
   * leave. New ideas join at the end; deleted ones drop out.
   */
  const [held, setHeld] = createSignal<string[] | null>(null);
  const hold = () => {
    if (!held()) setHeld(ranked().map((i) => i.id));
  };
  const release = (e: { currentTarget: HTMLElement; relatedTarget: EventTarget | null }) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld(null);
  };
  const ideas = createMemo(() => {
    const order = held();
    const list = ranked();
    if (!order) return list;
    const at = new Map(order.map((id, i) => [id, i]));
    return [...list].sort((a, b) => (at.get(a.id) ?? Infinity) - (at.get(b.id) ?? Infinity) || a.at - b.at);
  });

  const rows = createRows(() => ideas());

  return (
    <WidgetFrame
      {...props}
      kind="ideas"
      class={[parts.body, styles.ideas]}
      color={s().color(props.id)}
      label={`Ideas by ${author()}: ${s().listTitle(props.id) || "untitled"}, ${ideas().length} ideas`}
      deleteLabel="Delete ideas"
    >
      <TitleLine
        id={props.id}
        session={s()}
        readOnly={props.readOnly}
        placeholder={props.readOnly ? "Ideas" : "What are we deciding?"}
        label="Ideas title"
        onError={props.onError}
      />

      <ol
        class={[parts.scroll, styles.list]}
        data-scroll
        aria-label="Ideas"
        onPointerEnter={hold}
        onPointerLeave={(e) => {
          // Keyboard users still in the list keep it still too.
          if (!e.currentTarget.contains(document.activeElement)) setHeld(null);
        }}
        onFocusIn={hold}
        onFocusOut={(e) => {
          if (!e.currentTarget.matches(":hover")) release(e);
        }}
      >
        <For each={rows.ids()}>
          {(ideaId) => (
            <Show when={rows.get(ideaId)}>
              {(idea) => {
                const voted = () => idea().votes.includes(me());
                return (
                  <li class={styles.row} data-row>
                    <button
                      type="button"
                      class={styles.up}
                      aria-pressed={voted() ? "true" : "false"}
                      aria-label={`${voted() ? "Take back your vote for" : "Vote for"} ${idea().text}, ${idea().votes.length} ${idea().votes.length === 1 ? "vote" : "votes"}`}
                      onClick={() => void change({ do: "upvote", ideaId: idea().id, on: !voted() })}
                    >
                      <svg viewBox="0 0 12 12" aria-hidden="true">
                        <path d="M2.5 7.5 6 4l3.5 3.5" />
                      </svg>
                      <span>{idea().votes.length}</span>
                    </button>
                    <span class={styles.body}>
                      <EditableText
                        text={idea().text}
                        readOnly={props.readOnly}
                        max={IDEA_TEXT_MAX}
                        label="Idea text"
                        class={styles.text}
                        onSave={(text) => void change({ do: "edit", ideaId: idea().id, text })}
                        onEmpty={() => void change({ do: "remove", ideaId: idea().id })}
                        onEditing={(on) => s().setPresence({ action: on ? "typing" : null })}
                      />
                      <span class={styles.by} style={personVars(idea().hue)}>
                        <span class={parts.dot} aria-hidden="true" />
                        <span class={styles.byName}>{shownName(idea().by)}</span>
                      </span>
                    </span>
                    <Show when={!props.readOnly}>
                      <RemoveButton
                        label={`Remove ${idea().text}`}
                        onClick={() => void change({ do: "remove", ideaId: idea().id })}
                      />
                    </Show>
                  </li>
                );
              }}
            </Show>
          )}
        </For>
        <Show when={ideas().length === 0}>
          <li class={parts.muted}>{props.readOnly ? "No ideas yet." : "Throw in the first idea."}</li>
        </Show>
      </ol>

      <Show when={!props.readOnly && ideas().length < IDEAS_MAX}>
        <AddField
          session={s()}
          placeholder="Add an idea"
          max={IDEA_TEXT_MAX}
          onAdd={(text) => void change({ do: "add", ideaId: randomId(12), text })}
        />
      </Show>

      <Footer
        id={props.id}
        session={s()}
        readOnly={props.readOnly}
        width={props.rect.w}
        author={author()}
        colorLabel="Ideas color"
        onError={props.onError}
      />
    </WidgetFrame>
  );
}
