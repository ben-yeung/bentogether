/*
 * Light markdown for sticky notes. The note stores plain text; these helpers
 * turn "- " into a bullet as you type, carry lists on with Enter, and read
 * the text back as lines and inline styles for showing it.
 */

export const BULLET = "•";

/** Replace value[from, to) with text; the caret lands after it. */
export type Edit = { from: number; to: number; text: string };

/** Applies an edit to a string (what the textarea does natively). */
export function applyEdit(value: string, e: Edit): { value: string; caret: number } {
  return { value: value.slice(0, e.from) + e.text + value.slice(e.to), caret: e.from + e.text.length };
}

/**
 * After a space is typed: "- " or "* " at the start of a line (after any
 * indent) becomes "• ", and "[] " or "[ ] " becomes a box to tick, "☐ ".
 * Null when there's nothing to change.
 */
export function autoBullet(value: string, caret: number): Edit | null {
  const lineStart = value.lastIndexOf("\n", caret - 1) + 1;
  const m = /^(\s*)(?:([-*])|(?:• )?\[ ?\]) $/.exec(value.slice(lineStart, caret));
  if (!m) return null;
  const indent = m[1]!;
  const marker = m[2] ? BULLET : "☐";
  return { from: lineStart, to: caret, text: `${indent}${marker} ` };
}

const LIST_ITEM = /^(\s*)(?:([•\-*]) |(\d+)([.)]) |([☐☑]) )/;

/**
 * Enter on a list line: the next line starts with the same marker (numbers
 * count up, ticked boxes come back unticked). Enter on an empty item ends
 * the list instead. Null when the line isn't a list item.
 */
export function continueList(value: string, start: number, end: number): Edit | null {
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const lineEnd = value.indexOf("\n", end);
  const m = LIST_ITEM.exec(value.slice(lineStart, start));
  if (!m) return null;
  const [marker, indent, bullet, num, sep, box] = m;
  const rest = value.slice(end, lineEnd === -1 ? value.length : lineEnd);
  if (start - lineStart === marker!.length && rest.trim() === "") {
    // An empty item: drop its marker and stop the list.
    return { from: lineStart, to: end, text: "" };
  }
  const next = bullet ? `${bullet} ` : num ? `${Number(num) + 1}${sep} ` : box ? "☐ " : "";
  return { from: start, to: end, text: `\n${indent}${next}` };
}

// ------------------------------------------------------------------ reading

export type Inline = string | { style: "b" | "i" | "s" | "code"; children: Inline[] };

export type Line =
  | { kind: "h1" | "h2" | "quote" | "text"; inline: Inline[] }
  | { kind: "bullet" | "number" | "check"; marker: string; depth: number; done?: boolean; inline: Inline[] };

const INLINE =
  /\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|`([^`]+)`|(?<![\w*])\*(?![\s*])(.+?)(?<![\s*])\*(?![\w*])|(?<![\w_])_(?![\s_])(.+?)(?<![\s_])_(?![\w_])/g;

/** **bold**, *italic* or _italic_, ~~struck~~ and `code`; styles can nest, code can't. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const [, b1, b2, s, code, i1, i2] = m;
    if (code !== undefined) out.push({ style: "code", children: [code] });
    else if (s !== undefined) out.push({ style: "s", children: parseInline(s) });
    else if (b1 !== undefined || b2 !== undefined)
      out.push({ style: "b", children: parseInline((b1 ?? b2)!) });
    else out.push({ style: "i", children: parseInline((i1 ?? i2)!) });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Splits a note into lines: headings (#, ##), lists (•, -, *, 1., ☐/☑, [ ]/[x]), quotes (>) and text. */
export function parseNote(text: string): Line[] {
  return text.split("\n").map((raw): Line => {
    const indent = /^\s*/.exec(raw)![0];
    const depth = Math.floor(indent.replace(/\t/g, "  ").length / 2);
    const line = raw.slice(indent.length);
    let m: RegExpExecArray | null;
    if ((m = /^(#{1,6}) (.*)$/.exec(raw)))
      return { kind: m[1]!.length === 1 ? "h1" : "h2", inline: parseInline(m[2]!) };
    if ((m = /^> ?(.*)$/.exec(raw))) return { kind: "quote", inline: parseInline(m[1]!) };
    if ((m = /^(?:[•\-*] )?(?:\[([ xX])\]|([☐☑])) (.*)$/.exec(line))) {
      const done = m[1] ? m[1] !== " " : m[2] === "☑";
      return { kind: "check", marker: done ? "☑" : "☐", depth, done, inline: parseInline(m[3]!) };
    }
    if ((m = /^[•\-*] (.*)$/.exec(line)))
      return { kind: "bullet", marker: BULLET, depth, inline: parseInline(m[1]!) };
    if ((m = /^(\d+[.)]) (.*)$/.exec(line)))
      return { kind: "number", marker: m[1]!, depth, inline: parseInline(m[2]!) };
    return { kind: "text", inline: parseInline(raw) };
  });
}
