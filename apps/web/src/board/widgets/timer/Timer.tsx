import { createEffect, createMemo, createSignal, Show } from "solid-js";
import { TIMER_MAX_MS, timerLeft } from "@bentogether/shared";
import { formatDuration, parseDuration } from "../../../lib/duration";
import { WidgetFrame, type WidgetProps } from "../../frame/WidgetFrame";
import { changer, focusOnMount, Footer, parts, TitleLine, useAuthor } from "../../frame/parts";
import styles from "./Timer.module.css";

const MINUTE = 60_000;

/**
 * A countdown everyone shares. The server keeps when it ends (or what's
 * left while paused); each screen counts down on its own from that, using
 * the server's clock, so nothing is sent while it runs. Tap the time to
 * set a new length.
 */
export function Timer(props: WidgetProps) {
  const s = () => props.session;
  const change = changer(props, "timer");

  const timer = createMemo(() => s().live(props.id, "timer"));
  const running = () => timer()?.endsAt != null;
  const author = useAuthor(props);

  // Ticks only while the timer runs; the time left is read off the
  // server's clock at each tick, so a tick is all that's stored.
  const [tick, setTick] = createSignal(0);
  createEffect(
    () => running(),
    (on) => {
      if (!on) return;
      const timer = window.setInterval(() => setTick((n) => n + 1), 200);
      return () => clearInterval(timer);
    },
  );

  const left = () => {
    tick();
    const t = timer();
    return t ? timerLeft(t, s().serverNow()) : 0;
  };
  const done = () => running() && left() <= 0;
  const text = () => formatDuration(left());
  const state = () =>
    done() ? "Time's up" : running() ? "running" : left() === timer()?.duration ? "ready" : "paused";

  // ------------------------------------------------- set the length

  const [draft, setDraft] = createSignal<string | null>(null);
  let byKey = false;

  function startSet() {
    if (props.readOnly) return;
    setDraft(formatDuration(timer()?.duration ?? 5 * MINUTE));
    s().setPresence({ action: "typing" });
  }

  function commitSet() {
    const d = draft();
    if (d === null) return;
    setDraft(null);
    s().setPresence({ action: null });
    if (!byKey) swallowNextClick = true;
    byKey = false;
    const ms = parseDuration(d);
    if (ms === null || ms < 1000) {
      if (d.trim()) props.onError("Try 25, 1:30 or 1h.");
      return;
    }
    if (ms > TIMER_MAX_MS) {
      props.onError("A timer runs up to a day.");
      return;
    }
    void change({ do: "set", ms });
  }

  /** The click that closes the field shouldn't open it again. */
  let swallowNextClick = false;
  function activate() {
    if (swallowNextClick) {
      swallowNextClick = false;
      return;
    }
    if (!running()) startSet();
  }

  return (
    <WidgetFrame
      {...props}
      kind="timer"
      class={[parts.body, styles.timer]}
      color={s().color(props.id)}
      label={`Timer by ${author()}: ${s().listTitle(props.id) || "untitled"}, ${text()} ${state()}`}
      deleteLabel="Delete timer"
      onActivate={props.readOnly ? undefined : activate}
    >
      <TitleLine
        id={props.id}
        session={s()}
        readOnly={props.readOnly}
        placeholder={props.readOnly ? "Timer" : "Name this timer"}
        label="Timer title"
        onError={props.onError}
      />

      <div class={styles.stage} data-done={done()} data-running={running()}>
        <div class={styles.face}>
          <Show
            when={draft() !== null}
            fallback={
              <Show
                when={!props.readOnly && !running()}
                fallback={
                  <span class={styles.time} style={{ "--chars": text().length }} role="timer" aria-live="off">
                    {text()}
                  </span>
                }
              >
                <button
                  type="button"
                  class={[styles.time, styles.timeBtn]}
                  style={{ "--chars": text().length }}
                  aria-label={`${text()} ${state()}. Set the length`}
                  title="Set the length"
                  onClick={activate}
                >
                  {text()}
                </button>
              </Show>
            }
          >
            <input
              ref={focusOnMount}
              class={[parts.plain, styles.time, styles.timeInput]}
              style={{ "--chars": Math.max(5, draft()!.length + 1) }}
              value={draft()!}
              aria-label="Timer length"
              placeholder="5:00"
              onInput={(e) => void setDraft(e.currentTarget.value)}
              onBlur={commitSet}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  byKey = true;
                  e.currentTarget.blur();
                }
                if (e.key === "Escape") {
                  setDraft(null);
                  s().setPresence({ action: null });
                }
              }}
            />
          </Show>
          <span class={styles.state}>{state()}</span>
        </div>

        <Show when={!props.readOnly}>
          <div class={styles.controls}>
            <button
              type="button"
              class={styles.side}
              aria-label="Reset"
              title="Reset"
              onClick={() => void change({ do: "reset" })}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M3 8a5 5 0 1 0 1.5-3.55M3 3v2.5h2.5" />
              </svg>
            </button>
            <button
              type="button"
              class={styles.main}
              aria-label={running() && !done() ? "Pause" : "Start"}
              onClick={() => void change({ do: running() && !done() ? "pause" : "start" })}
            >
              <Show
                when={running() && !done()}
                fallback={
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M5 3.2v9.6L12.5 8z" />
                  </svg>
                }
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M5 3.5v9M11 3.5v9" />
                </svg>
              </Show>
            </button>
            <button
              type="button"
              class={styles.side}
              aria-label="Add a minute"
              title="Add a minute"
              onClick={() => void change({ do: "add", ms: MINUTE })}
            >
              +1m
            </button>
          </div>
        </Show>
      </div>

      <Footer
        id={props.id}
        session={s()}
        readOnly={props.readOnly}
        width={props.rect.w}
        author={author()}
        colorLabel="Timer color"
        onError={props.onError}
      />
    </WidgetFrame>
  );
}
