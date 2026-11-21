import { createMemo, createSignal, For, Show } from "solid-js";
import {
  ASK_PEOPLE_MAX,
  ASK_TEXT_MAX,
  ASKS_PER_PERSON_MAX,
  NAME_MAX,
  randomId,
  type AskPerson,
} from "@bentogether/shared";
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
import styles from "./Asks.module.css";

/** When you last opened each person, on this device only. */
function seenKey(widgetId: string, personId: string) {
  return `bento:asks-seen:${widgetId}:${personId}`;
}
function readSeen(widgetId: string, personId: string): number {
  try {
    return Number(localStorage.getItem(seenKey(widgetId, personId))) || 0;
  } catch {
    return 0;
  }
}
function writeSeen(widgetId: string, personId: string, at: number) {
  try {
    localStorage.setItem(seenKey(widgetId, personId), String(at));
  } catch {
    // Private mode: unread counts just don't stick.
  }
}

/**
 * Asks and wants for each person on the team. The front shows everyone with
 * how many asks are open and how many are new to you; open someone to see
 * and tick off theirs. Which person you have open, and what you've seen,
 * stay on your screen.
 */
export function Asks(props: WidgetProps) {
  const s = () => props.session;
  const change = changer(props, "asks");
  const board = createMemo(() => s().live(props.id, "asks"));
  const author = useAuthor(props);
  const people = () => board()?.people ?? [];

  const [openId, setOpenId] = createSignal<string | null>(null);
  const open = createMemo(() => people().find((p) => p.id === openId()) ?? null);
  /** Bumped when you mark someone seen, so the counts re-read storage. */
  const [seenRev, setSeenRev] = createSignal(0);

  const unread = (p: AskPerson) => {
    seenRev();
    const seen = readSeen(props.id, p.id);
    const me = s().peers[s().server.sid]?.name;
    return p.asks.filter((a) => !a.done && a.at > seen && a.by !== me).length;
  };
  const openCount = (p: AskPerson) => p.asks.filter((a) => !a.done).length;
  const totalUnread = createMemo(() => {
    let n = 0;
    for (const p of people()) n += unread(p);
    return n;
  });

  function markSeen(p: AskPerson) {
    writeSeen(props.id, p.id, s().serverNow());
    setSeenRev((n) => n + 1);
  }

  function openPerson(p: AskPerson) {
    setOpenId(p.id);
    markSeen(p);
  }

  function close() {
    const p = open();
    if (p) markSeen(p);
    setOpenId(null);
  }

  const peopleRows = createRows(() => people());
  const askRows = createRows(() => open()?.asks ?? []);

  const editing = (on: boolean) => s().setPresence({ action: on ? "typing" : null });

  return (
    <WidgetFrame
      {...props}
      kind="asks"
      class={[parts.body, styles.asks]}
      color={s().color(props.id)}
      label={`Asks by ${author()}: ${s().listTitle(props.id) || "untitled"}, ${people().length} people`}
      deleteLabel="Delete asks"
    >
      <Show
        when={open()}
        fallback={
          <>
            <TitleLine
              id={props.id}
              session={s()}
              readOnly={props.readOnly}
              placeholder={props.readOnly ? "Asks" : "Team asks"}
              label="Asks title"
              onError={props.onError}
            />
            <ul class={[parts.scroll, styles.people]} aria-label="People">
              <For each={peopleRows.ids()}>
                {(personId) => (
                  <Show when={peopleRows.get(personId)}>
                    {(p) => (
                      <li class={styles.person} data-row>
                        <button
                          type="button"
                          class={styles.personBtn}
                          aria-label={`${p().name}: ${openCount(p())} open${unread(p()) ? `, ${unread(p())} new` : ""}`}
                          onClick={() => openPerson(p())}
                        >
                          <span class={styles.avatar} data-unread={unread(p()) > 0} aria-hidden="true">
                            {p().name.slice(0, 1).toUpperCase()}
                          </span>
                          <span class={styles.name}>{p().name}</span>
                          <span class={styles.open} aria-hidden="true">
                            {openCount(p())} open
                          </span>
                        </button>
                        <Show when={!props.readOnly}>
                          {/* Hovering near the right edge slides the row over to show delete. */}
                          <span class={styles.reveal} aria-hidden="true" />
                          <RemoveButton
                            class={styles.remove}
                            label={`Remove ${p().name}`}
                            onClick={() => void change({ do: "removePerson", personId: p().id })}
                          />
                        </Show>
                      </li>
                    )}
                  </Show>
                )}
              </For>
              <Show when={people().length === 0}>
                <li class={parts.muted}>
                  {props.readOnly ? "Nobody here yet." : "Add the people on your team."}
                </li>
              </Show>
            </ul>
            <Show when={!props.readOnly && people().length < ASK_PEOPLE_MAX}>
              <AddField
                session={s()}
                placeholder="Add a person"
                max={NAME_MAX}
                onAdd={(name) => void change({ do: "addPerson", personId: randomId(12), name })}
              />
            </Show>
          </>
        }
      >
        {(p) => (
          <>
            <div class={styles.head}>
              <button type="button" class={parts.icon} aria-label="Back to everyone" onClick={close}>
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M10 3.5 5.5 8l4.5 4.5" />
                </svg>
              </button>
              <EditableText
                text={p().name}
                readOnly={props.readOnly}
                max={NAME_MAX}
                label="Person's name"
                class={styles.headName}
                onSave={(name) => void change({ do: "renamePerson", personId: p().id, name })}
                onEditing={editing}
              />
            </div>
            <ul class={[parts.scroll, styles.asksList]} aria-label={`Asks for ${p().name}`}>
              <For each={askRows.ids()}>
                {(askId) => (
                  <Show when={askRows.get(askId)}>
                    {(a) => (
                      <li class={styles.ask} data-row data-done={a().done}>
                        <button
                          type="button"
                          role="checkbox"
                          class={styles.check}
                          aria-checked={a().done ? "true" : "false"}
                          aria-label={a().text}
                          aria-disabled={props.readOnly ? "true" : undefined}
                          onClick={() => {
                            if (!props.readOnly)
                              void change({
                                do: "checkAsk",
                                personId: p().id,
                                askId: a().id,
                                done: !a().done,
                              });
                          }}
                        >
                          <svg viewBox="0 0 12 12" aria-hidden="true">
                            <path d="M2.5 6.2 5 8.6l4.5-5" />
                          </svg>
                        </button>
                        <span class={styles.askBody}>
                          <span class={styles.askText}>{a().text}</span>
                          <span class={styles.askBy} style={personVars(a().hue)}>
                            <span class={parts.dot} aria-hidden="true" /> {shownName(a().by)}
                          </span>
                        </span>
                        <Show when={!props.readOnly}>
                          <RemoveButton
                            label={`Remove ${a().text}`}
                            onClick={() => void change({ do: "removeAsk", personId: p().id, askId: a().id })}
                          />
                        </Show>
                      </li>
                    )}
                  </Show>
                )}
              </For>
              <Show when={p().asks.length === 0}>
                <li class={parts.muted}>Nothing asked of {p().name} yet.</li>
              </Show>
            </ul>
            <Show when={!props.readOnly && p().asks.length < ASKS_PER_PERSON_MAX}>
              <AddField
                session={s()}
                placeholder={`Ask ${p().name} for…`}
                max={ASK_TEXT_MAX}
                onAdd={(text) => void change({ do: "addAsk", personId: p().id, askId: randomId(12), text })}
              />
            </Show>
          </>
        )}
      </Show>

      <Footer
        id={props.id}
        session={s()}
        readOnly={props.readOnly}
        width={props.rect.w}
        author={author()}
        colorLabel="Asks color"
        onError={props.onError}
        info={
          <Show when={!open() && totalUnread() > 0}>
            <span class={styles.newCount}>{totalUnread()} new</span>
          </Show>
        }
      />
    </WidgetFrame>
  );
}
