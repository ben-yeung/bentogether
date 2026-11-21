/**
 * Operational transform for a note's plain text, so several people can type
 * in one note at once.
 *
 * An edit is a walk along the text from the start: keep `n` characters,
 * insert a string, or delete `n` characters (`{ d: n }`). Whatever is left
 * after the last component is kept. Positions count UTF-16 code units, the
 * same as a textarea's selection.
 *
 * The box's Durable Object puts every edit to a note in one order. An edit
 * typed against an older version is moved past the edits it missed
 * (`transformText`) before it's applied, and each client moves its own
 * unconfirmed edits past the ones it hears about in the same way. When two
 * people insert at the same spot, the edit the server applied first goes
 * first: it's the "left" side.
 */
export type TextComponent = number | string | { d: number };
export type TextOp = TextComponent[];

/** Which of two edits at the same spot goes first. */
export type Side = "left" | "right";

function length(c: TextComponent): number {
  return typeof c === "number" ? c : typeof c === "string" ? c.length : c.d;
}

/** Adds a component, merging it with the last one when they're the same kind. */
function append(op: TextOp, c: TextComponent) {
  if (length(c) === 0) return;
  const last = op[op.length - 1];
  if (typeof c === "number" && typeof last === "number") op[op.length - 1] = last + c;
  else if (typeof c === "string" && typeof last === "string") op[op.length - 1] = last + c;
  else if (typeof c === "object" && typeof last === "object") op[op.length - 1] = { d: last.d + c.d };
  else op.push(c);
}

/** Drops a trailing keep: it means the same as nothing. */
function trim(op: TextOp): TextOp {
  if (typeof op[op.length - 1] === "number") op.pop();
  return op;
}

/**
 * Reads an edit piece by piece. `take(n)` returns up to `n` of the next
 * component (a keep of `n` once the edit runs out); `take(-1)` returns the
 * rest of it, or null at the end. `whole` takes that kind of component in
 * one piece, whatever `n` is.
 */
function reader(op: TextOp) {
  let i = 0;
  let offset = 0;
  function take(n: number, whole?: "insert" | "delete"): TextComponent | null {
    if (i === op.length) return n === -1 ? null : n;
    const c = op[i]!;
    const left = length(c) - offset;
    const all =
      n === -1 ||
      left <= n ||
      (whole === "insert" && typeof c === "string") ||
      (whole === "delete" && typeof c === "object");
    const size = all ? left : n;
    const part: TextComponent =
      typeof c === "number" ? size : typeof c === "string" ? c.slice(offset, offset + size) : { d: size };
    if (all) {
      i++;
      offset = 0;
    } else offset += size;
    return part;
  }
  const peek = () => op[i];
  return { take, peek };
}

/** The edit tidied: no empty parts, neighbours of a kind merged, no trailing keep. */
export function normalizeText(op: TextOp): TextOp {
  const out: TextOp = [];
  for (const c of op) append(out, c);
  return trim(out);
}

/** True when the edit changes nothing. */
export function isNoopText(op: TextOp): boolean {
  return op.every((c) => typeof c === "number" || length(c) === 0);
}

/** Characters of the text the edit walks over (keeps and deletes). */
export function textOpSpan(op: TextOp): number {
  let n = 0;
  for (const c of op) if (typeof c !== "string") n += length(c);
  return n;
}

/** The text after the edit. Throws if the edit walks past the end. */
export function applyText(text: string, op: TextOp): string {
  if (textOpSpan(op) > text.length) throw new RangeError("The edit runs past the end of the text.");
  const out: string[] = [];
  let at = 0;
  for (const c of op) {
    if (typeof c === "number") {
      out.push(text.slice(at, at + c));
      at += c;
    } else if (typeof c === "string") out.push(c);
    else at += c.d;
  }
  out.push(text.slice(at));
  return out.join("");
}

/**
 * `op` moved past `other`, both typed against the same text, so it can be
 * applied after `other`. `side` says whose insert goes first when both
 * insert at the same spot. Applying `other` then `transform(op, other, s)`
 * gives the same text as `op` then `transform(other, op, opposite of s)`.
 */
export function transformText(op: TextOp, other: TextOp, side: Side): TextOp {
  const out: TextOp = [];
  const { take, peek } = reader(op);
  for (const c of other) {
    if (typeof c === "number") {
      // They keep: copy ours across that stretch, inserts and all.
      let n = c;
      while (n > 0) {
        const part = take(n, "insert")!;
        append(out, part);
        if (typeof part !== "string") n -= length(part);
      }
    } else if (typeof c === "string") {
      // They insert: ours goes first only when we're left; then step over theirs.
      if (side === "left" && typeof peek() === "string") append(out, take(-1)!);
      append(out, c.length);
    } else {
      // They delete: whatever of ours covered that text is gone with it.
      let n = c.d;
      while (n > 0) {
        const part = take(n, "insert")!;
        if (typeof part === "string") append(out, part);
        else n -= length(part);
      }
    }
  }
  for (let part = take(-1); part !== null; part = take(-1)) append(out, part);
  return trim(out);
}

/** One edit that does `a` then `b`. */
export function composeText(a: TextOp, b: TextOp): TextOp {
  const out: TextOp = [];
  const { take } = reader(a);
  for (const c of b) {
    if (typeof c === "number") {
      let n = c;
      while (n > 0) {
        const part = take(n, "delete")!;
        append(out, part);
        if (typeof part !== "object") n -= length(part);
      }
    } else if (typeof c === "string") append(out, c);
    else {
      let n = c.d;
      while (n > 0) {
        const part = take(n, "delete")!;
        if (typeof part === "number") {
          append(out, { d: part });
          n -= part;
        } else if (typeof part === "string") n -= part.length;
        else append(out, part);
      }
    }
  }
  for (let part = take(-1); part !== null; part = take(-1)) append(out, part);
  return trim(out);
}

/**
 * Where a position in the text ends up after an edit. Text inserted right
 * at the position goes after it, so another person's caret stays put while
 * someone types next to it.
 */
export function transformIndex(index: number, op: TextOp): number {
  let at = 0;
  let pos = index;
  for (const c of op) {
    if (pos <= at) break;
    if (typeof c === "number") {
      if (pos <= at + c) return pos;
      at += c;
    } else if (typeof c === "string") {
      at += c.length;
      pos += c.length;
    } else pos -= Math.min(c.d, pos - at);
  }
  return pos;
}

const isHigh = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLow = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/**
 * The edit that turns `before` into `after`: one replaced stretch, which is
 * what a single input event makes. `caret` is the caret after the change;
 * it settles where in a run of the same letter the change happened, so
 * typing "a" into "aa" between them inserts there, not at the end.
 */
export function diffText(before: string, after: string, caret = after.length): TextOp {
  if (before === after) return [];
  const most = Math.min(before.length, after.length);
  let suffix = 0;
  const maxSuffix = Math.min(most, Math.max(0, after.length - caret));
  while (
    suffix < maxSuffix &&
    before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)
  )
    suffix++;
  let prefix = 0;
  const maxPrefix = most - suffix;
  while (prefix < maxPrefix && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix++;
  // Never split an emoji (a surrogate pair) between the kept and changed parts.
  if (prefix > 0 && isHigh(before.charCodeAt(prefix - 1))) prefix--;
  if (suffix > 0 && isLow(before.charCodeAt(before.length - suffix))) suffix--;
  return normalizeText([
    prefix,
    { d: before.length - prefix - suffix },
    after.slice(prefix, after.length - suffix),
  ]);
}
