import { action, createOptimistic, createSignal, For, onSettled, Show } from "solid-js";
import { DEFAULT_BOX_OPTIONS, PERSON_HUES, type BoxOptions, type CreatedBox } from "@bentogether/shared";
import { Lockup, Mark } from "../brand/Logo";
import { BoxNotFound, createBox, getBox } from "../lib/api";
import { createdLabel, widgetsLabel } from "../lib/format";
import { personVars } from "../lib/identity";
import { loadDevice, rememberName, saveHue, suggestName, takeHandedOffName } from "../lib/identity";
import { saveOwnerToken } from "../lib/owner";
import { forgetBox, loadRecent, setCreatedAt, type RecentBox } from "../lib/recent";
import { navigate } from "../lib/router";
import { NameField } from "../ui/NameField";
import { Splash } from "../ui/Splash";
import { Switch } from "../ui/Switch";
import { createToaster } from "../ui/toasts";
import styles from "./pages.module.css";

/**
 * The opening splash: a centered modal over a packed, out-of-focus bento.
 * Left: make a bento (its name, your name and color, its settings).
 * Right: the bentos you've been in, filling the column.
 */
export function Home() {
  const device = loadDevice();
  const { push, Toasts } = createToaster();

  // Picked once: a JSX expression would re-run and swap the name under you.
  const suggested = takeHandedOffName() ?? suggestName();
  const [hue, setHue] = createSignal(device.hue);
  const [options, setOptions] = createSignal<BoxOptions>({ ...DEFAULT_BOX_OPTIONS });
  const [starter, setStarter] = createSignal(true);
  const [packing, setPacking] = createOptimistic(false);

  const start = action(function* (title: string, name: string) {
    setPacking(true);
    try {
      const box: CreatedBox = yield createBox({
        title,
        options: options(),
        starter: starter(),
        creator: { name, hue: hue() },
      });
      rememberName(box.id, name);
      saveOwnerToken(box.id, box.ownerToken);
      navigate(`/b/${box.id}`);
    } catch (err) {
      push((err as Error).message, "error");
    }
  });

  document.title = "benTogether · pack ideas into a bento together";

  return (
    <main class={styles.page}>
      <Splash label="Start a new bento" size="wide">
        <div class={styles.split}>
          <section class={styles.makeCol}>
            <div class={styles.modalHead}>
              <Lockup />
              <p class={styles.tagline}>Pack ideas into a bento together.</p>
            </div>

            <form
              class={styles.form}
              onSubmit={(e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                const title = data.get("title")?.toString().trim() ?? "";
                const name = data.get("name")?.toString().trim() || suggested;
                void start(title, name);
              }}
            >
              <label class={styles.field}>
                <span class={styles.fieldLabel}>Bento</span>
                <input
                  name="title"
                  class={["field", styles.input]}
                  placeholder="Team lunch"
                  maxlength={60}
                  aria-label="Bento name"
                  autofocus
                />
              </label>

              <NameField
                defaultName={suggested}
                hue={hue()}
                onHue={(h) => {
                  setHue(h);
                  saveHue(h);
                }}
              />

              <fieldset class={styles.options}>
                <legend class={styles.fieldLabel}>Options</legend>
                <Switch
                  label="Live cursors"
                  hint="See where everyone is pointing."
                  checked={options().cursors}
                  onChange={(v) => setOptions((o) => ({ ...o, cursors: v }))}
                />
                <Switch
                  label="Auto-pack"
                  hint="Fill gaps automatically, or place widgets freely."
                  checked={options().autoPack}
                  onChange={(v) => setOptions((o) => ({ ...o, autoPack: v }))}
                />
                <Switch
                  label="Starter bento"
                  hint="Start with an example of every widget."
                  checked={starter()}
                  onChange={setStarter}
                />
              </fieldset>

              <button type="submit" class={["btn btn-primary", styles.submit]} disabled={packing()}>
                {packing() ? "Packing the bento…" : "Create bento"}
              </button>
            </form>
          </section>

          <aside class={styles.browseCol} aria-label="Bentos">
            <RecentBoxes />
          </aside>
        </div>
      </Splash>
      <Toasts />
    </main>
  );
}

function RecentBoxes() {
  const initial = loadRecent();
  const [recent, setRecent] =
    createSignal<Array<RecentBox & { widgetCount?: number; hues?: number[] }>>(initial);

  // Look each one up in the background for its live counts (and its
  // creation date, for entries saved before dates existed).
  onSettled(() => {
    for (const box of initial) {
      getBox(box.id)
        .then((info) => {
          if (!box.createdAt) setCreatedAt(box.id, info.createdAt);
          setRecent((list) =>
            list.map((b) =>
              b.id === box.id
                ? {
                    ...b,
                    title: info.title,
                    createdAt: info.createdAt,
                    widgetCount: info.widgetCount,
                    hues: info.hues ?? [],
                  }
                : b,
            ),
          );
        })
        .catch((err: unknown) => {
          if (!(err instanceof BoxNotFound)) return;
          forgetBox(box.id);
          setRecent((list) => list.filter((b) => b.id !== box.id));
        });
    }
  });

  return (
    <section class={styles.browse} aria-labelledby="recent-heading">
      <h2 id="recent-heading" class={styles.browseHeading}>
        Your recent bentos
      </h2>
      <Show
        when={recent().length > 0}
        fallback={<p class={styles.browseEmpty}>Bentos you open show up here.</p>}
      >
        <ul class={styles.boxList}>
          <For each={recent()} keyed={(b) => b.id}>
            {(box) => (
              <BoxLink
                id={box().id}
                title={box().title}
                createdAt={box().createdAt}
                // A blank line until the counts arrive keeps rows the same height.
                meta={box().widgetCount === undefined ? "\u00a0" : widgetsLabel(box().widgetCount!)}
                hues={MOCK_PRESENCE ? mockHues(box().id) : (box().hues ?? [])}
                onForget={() => {
                  forgetBox(box().id);
                  setRecent((list) => list.filter((b) => b.id !== box().id));
                }}
              />
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}

function BoxLink(props: {
  id: string;
  title: string;
  meta: string;
  /** Colors of who's on it right now. */
  hues: number[];
  createdAt?: number | undefined;
  /** Drops it from this list only; the bento itself is untouched. */
  onForget: () => void;
}) {
  return (
    <li class={styles.boxRow}>
      <a
        class={styles.boxLink}
        href={`/b/${props.id}`}
        onClick={(e) => {
          e.preventDefault();
          navigate(`/b/${props.id}`);
        }}
      >
        <Mark size={32} />
        <span class={styles.boxText}>
          <span class={styles.boxTitle}>{props.title}</span>
          <span class={styles.boxMeta}>
            {props.meta}
            <Show when={props.hues.length > 0}>
              <Presence hues={props.hues} />
            </Show>
          </span>
        </span>
        <Show when={createdLabel(props.createdAt)}>
          {(label) => (
            <time class={styles.boxDate} datetime={new Date(props.createdAt!).toISOString()} title="Created">
              {label()}
            </time>
          )}
        </Show>
      </a>
      <button
        type="button"
        class={["icon-btn", styles.boxForget]}
        aria-label={`Remove ${props.title} from this list`}
        title="Remove from this list"
        onClick={() => props.onForget()}
      >
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        </svg>
      </button>
    </li>
  );
}

const MAX_DOTS = 5;

/** Who's on a bento right now: up to five dots in their colors, then "+N". */
function Presence(props: { hues: number[] }) {
  const extra = () => props.hues.length - MAX_DOTS;
  return (
    <span
      class={styles.presence}
      aria-label={`${props.hues.length} ${props.hues.length === 1 ? "person" : "people"} here now`}
      role="img"
    >
      <For each={props.hues.slice(0, MAX_DOTS)}>
        {(hue) => <span class={styles.presenceDot} style={personVars(hue)} />}
      </For>
      <Show when={extra() > 0}>
        <span class={styles.presenceMore}>+{extra()}</span>
      </Show>
    </span>
  );
}

// TEMPORARY (dev only): `/?mock=presence` fills recent rows with made-up
// people so the presence dots can be reviewed. Stripped from production
// builds (import.meta.env.DEV is false there). Remove when no longer needed.
const MOCK_PRESENCE = import.meta.env.DEV && new URLSearchParams(location.search).get("mock") === "presence";
const MOCK_COUNTS = [1, 3, 5, 7, 0, 2, 9, 4, 6, 12];

function mockHues(id: string): number[] {
  let seed = [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const count = MOCK_COUNTS[seed % MOCK_COUNTS.length]!;
  // Distinct colors, like the server hands out (no repeats until all 18).
  const pool = [...PERSON_HUES];
  return Array.from({ length: count }, (_, i) => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    if (i % PERSON_HUES.length === 0) pool.splice(0, pool.length, ...PERSON_HUES);
    return pool.splice(seed % pool.length, 1)[0]!;
  });
}
