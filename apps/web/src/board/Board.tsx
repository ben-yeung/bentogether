import { createMemo, createSignal, For, onSettled, Show } from "solid-js";
import { GRID_COLS, clampRect, personTone, rowsUsed, settle, type Rect } from "@bentogether/shared";
import { RemoteCursors, SelfTag } from "../cursors/Cursors";
import { cursorCss, oklchToHex } from "../cursors/cursorImage";
import type { PointerVariant } from "../cursors/Pointer";
import { useMedia } from "../lib/media";
import { isDark } from "../lib/theme";
import { Note } from "./Note";
import type { BoxSession } from "./session";
import styles from "./Board.module.css";

const DRAG_THRESHOLD = 4;
const MIN_ROWS = 4;
/**
 * Gutter as a fraction of the pitch. Everything inside the box (gutters,
 * note padding, note text) is proportional to the pitch, so every viewer
 * sees the same picture at their own scale: same line wraps, same caret
 * positions, whether they're on a 2K laptop or a 4K display.
 */
const GUTTER_RATIO = 0.07;

type LocalDrag = { id: string; mode: "move" | "resize"; rect: Rect; carry: { x: number; y: number } | null };

/**
 * The box: a 12-column grid of compartments with everyone's cursors on top.
 *
 * Layout while dragging is a pure function of state: the committed rects
 * plus whichever drag is in progress (yours first, else someone else's),
 * packed by the same `settle` the server runs. So you see the box make room
 * as you, or anyone, carries a compartment, before anything is committed.
 */
export function Board(props: { session: BoxSession; onError: (message: string) => void }) {
  const s = () => props.session;
  let boardEl!: HTMLDivElement;

  const [width, setWidth] = createSignal(960);
  /** Window height left for the box below its top edge. */
  const [room, setRoom] = createSignal(600);
  // 12 cells + 11 gutters fill the width, and gutter = ratio × pitch.
  const pitch = createMemo(() => width() / (GRID_COLS - GUTTER_RATIO));
  const gutter = createMemo(() => pitch() * GUTTER_RATIO);

  // Resizing rescales everything; that should snap, not animate. Motion is
  // for things people do (moves, resizes of notes), not for the window.
  const [instant, setInstant] = createSignal(true);
  let settleTimer = 0;

  onSettled(() => {
    const measure = () => {
      setInstant(true);
      setWidth(boardEl.clientWidth);
      setRoom(innerHeight - (boardEl.getBoundingClientRect().top + scrollY));
      clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => setInstant(false), 150);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(boardEl);
    addEventListener("resize", measure);
    measure();
    return () => {
      ro.disconnect();
      clearTimeout(settleTimer);
      removeEventListener("resize", measure);
    };
  });

  const finePointer = useMedia("(pointer: fine)");
  const reduceMotion = useMedia("(prefers-reduced-motion: reduce)");

  // ------------------------------------------------------------- layout

  const [local, setLocal] = createSignal<LocalDrag | null>(null);

  const me = createMemo(() => s().peers[s().server.sid]);
  const others = createMemo(() => Object.values(s().peers).filter((p) => p.sid !== s().server.sid));

  const remoteDrag = createMemo(() => {
    const mine = local()?.id;
    for (const p of others()) {
      const d = p.presence.drag;
      if (d && d.id !== mine) return { ...d, hue: p.hue, sid: p.sid };
    }
    return null;
  });

  const layout = createMemo(() => {
    const items = s().rects();
    const drag = local() ?? (remoteDrag() && { id: remoteDrag()!.id, rect: remoteDrag()! });
    const packed =
      drag && items.some((i) => i.id === drag.id)
        ? settle(
            items.map((i) => (i.id === drag.id ? { id: i.id, ...pick(drag.rect) } : i)),
            drag.id,
            { gravity: s().options().autoPack },
          )
        : items;
    return new Map(packed.map((p) => [p.id, p]));
  });

  // Fill the screen; grow past it when the content does. A taller screen
  // just shows more empty rows, positions are identical for everyone.
  const rows = createMemo(() =>
    Math.max(MIN_ROWS, Math.floor((room() + gutter()) / pitch()), rowsUsed([...layout().values()]) + 2),
  );

  // ------------------------------------------------------- your cursor

  // The pointer itself is a hardware CSS cursor (zero lag). Only the "you"
  // pill is DOM, and it's moved straight from the event, outside the graph.
  const [inside, setInside] = createSignal(false);
  const [flipTag, setFlipTag] = createSignal(false);
  const [hover, setHover] = createSignal<PointerVariant>("dart");
  // Follows the in-app light/dark setting, not just the OS.
  let selfTag: HTMLDivElement | undefined;

  const selfVariant = createMemo<PointerVariant>(() => {
    const d = local();
    return d ? (d.mode === "resize" ? "resize" : "grab") : hover();
  });
  const customCursor = createMemo(() => finePointer() && s().options().cursors);
  const cursorStyle = createMemo(() => {
    const self = me();
    if (!customCursor() || !self) return undefined;
    // Same oklch the pill uses, resolved to hex (cursor images can't read CSS).
    const root = getComputedStyle(document.documentElement);
    void isDark();
    const tone = personTone(self.hue);
    const l = tone.l + (parseFloat(root.getPropertyValue("--person-dl")) || 0);
    const c = tone.c;
    const size = Math.round(parseFloat(root.fontSize) * 1.25);
    return cursorCss(selfVariant(), oklchToHex(l, c, tone.h), size);
  });

  const selfAction = createMemo(() => {
    const d = local();
    if (d) return d.mode === "move" ? "moving" : "resizing";
    return hover() === "ibeam" ? "typing" : null;
  });

  function boardPoint(e: PointerEvent) {
    const r = boardEl.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onBoardMove(e: PointerEvent) {
    const p = boardPoint(e);
    if (selfTag) selfTag.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
    setInside(true);
    setFlipTag(p.x + 170 > width());
    const t = e.target as Element;
    setHover(
      t.closest("textarea")
        ? "ibeam"
        : t.closest("[data-resize]")
          ? "resize"
          : t.closest("button, [data-note]:not([data-readonly])")
            ? "hand"
            : "dart",
    );
    s().setPresence({ cursor: { x: round2(p.x / pitch()), y: round2(p.y / pitch()) } });
  }

  function onBoardLeave() {
    if (local()) return;
    setInside(false);
    s().setPresence({ cursor: null });
  }

  // --------------------------------------------------------------- drag

  function beginDrag(e: PointerEvent, id: string, mode: "move" | "resize") {
    if (e.button !== 0 || !s().canEdit()) return;
    const r0 = s().rect(id);
    if (!r0) return;
    const noteEl = (e.currentTarget as Element).closest<HTMLElement>("[data-note]");
    const start = { x: e.clientX, y: e.clientY };
    const origin = { x: r0.x * pitch(), y: r0.y * pitch() };
    const p0 = boardPoint(e);
    const grab = { x: p0.x - origin.x, y: p0.y - origin.y };
    let started = false;
    let last: Rect = r0;

    const move = (ev: PointerEvent) => {
      if (!started && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_THRESHOLD) return;
      if (!started) {
        started = true;
        if (noteEl) noteEl.dataset.dragged = "true";
      }
      const p = boardPoint(ev);
      let rect: Rect;
      let carry: LocalDrag["carry"] = null;
      if (mode === "move") {
        carry = { x: p.x - grab.x, y: p.y - grab.y };
        rect = clampRect({ ...r0, x: carry.x / pitch(), y: carry.y / pitch() });
      } else {
        rect = clampRect({ ...r0, w: (p.x - origin.x) / pitch(), h: (p.y - origin.y) / pitch() });
        rect = { ...rect, x: r0.x, y: r0.y };
      }
      setLocal({ id, mode, rect, carry });
      if (!sameRect(rect, last)) {
        last = rect;
        s().setPresence({ drag: { id, ...rect }, action: mode === "move" ? "moving" : "resizing" });
      }
    };

    const end = (ev: PointerEvent) => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", end);
      removeEventListener("pointercancel", end);
      if (!started) return;
      setTimeout(() => noteEl && delete noteEl.dataset.dragged, 0);
      const cancelled = ev.type === "pointercancel";
      setLocal(null);
      s().setPresence({ drag: null, action: null });
      if (!cancelled && !sameRect(last, r0)) {
        s()
          .moveNote(id, last)
          .catch((err: Error) => props.onError(err.message));
      }
    };

    addEventListener("pointermove", move);
    addEventListener("pointerup", end);
    addEventListener("pointercancel", end);
  }

  // ------------------------------------------------------------- render

  const ghost = createMemo(() => {
    const d = local();
    return d && d.mode === "move" ? (layout().get(d.id) ?? null) : null;
  });

  return (
    <div class={styles.scroller}>
      <div
        ref={boardEl}
        class={styles.board}
        data-custom-cursor={customCursor()}
        data-instant={instant()}
        style={{
          cursor: cursorStyle(),
          "--pitch": `${pitch()}px`,
          "--gutter": `${gutter()}px`,
          height: `${rows() * pitch() - gutter()}px`,
        }}
        onPointerMove={onBoardMove}
        onPointerLeave={onBoardLeave}
      >
        <Show when={ghost()}>
          {(g) => (
            <div
              class={styles.ghost}
              style={{ "--x": g().x, "--y": g().y, "--w": g().w, "--h": g().h }}
              aria-hidden="true"
            />
          )}
        </Show>

        <For each={s().ids()}>
          {(id) => {
            const rect = createMemo(() => layout().get(id) ?? s().rect(id)!, { equals: sameRect });
            const mine = createMemo(() => (local()?.id === id ? local() : null));
            const theirs = createMemo(() => (remoteDrag()?.id === id ? remoteDrag() : null));
            const typistHue = createMemo(() => {
              const sid = s().leases[id];
              return sid && sid !== s().server.sid ? (s().peers[sid]?.hue ?? null) : null;
            });
            return (
              <Note
                id={id}
                session={s()}
                rect={rect()}
                mode={mine() ? "lifted" : theirs() ? "remote-lifted" : "rest"}
                carry={mine()?.carry ?? null}
                ringHue={theirs()?.hue ?? typistHue()}
                onPointerDown={(e, mode) => beginDrag(e, id, mode)}
                onError={props.onError}
                readOnly={!s().canEdit()}
              />
            );
          }}
        </For>

        <Show when={s().ids().length === 0}>
          <div class={styles.empty}>
            <p class={styles.emptyTitle}>An empty bento.</p>
            <p>Add a note to fill the first compartment.</p>
          </div>
        </Show>

        <Show when={s().options().cursors}>
          <RemoteCursors peers={others()} pitch={pitch()} width={width()} reduceMotion={reduceMotion()} />
        </Show>
        <Show when={customCursor() && me()}>
          {(self) => (
            <SelfTag
              ref={(el) => (selfTag = el)}
              hue={self().hue}
              name="you"
              action={selfAction()}
              visible={inside()}
              flipX={flipTag()}
              reduceMotion={reduceMotion()}
            />
          )}
        </Show>
      </div>
    </div>
  );
}

function pick(r: Rect): Rect {
  return { x: r.x, y: r.y, w: r.w, h: r.h };
}

function sameRect(a: Rect | undefined, b: Rect | undefined) {
  return !!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
