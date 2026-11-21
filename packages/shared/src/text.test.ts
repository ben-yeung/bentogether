import { describe, expect, it } from "vitest";
import {
  applyText,
  composeText,
  diffText,
  isNoopText,
  normalizeText,
  transformIndex,
  transformText,
  type TextOp,
} from "./text";

/** A small seeded random, so a failing case can be replayed. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LETTERS = "ab xy\n😀";

function randomText(r: () => number, max = 12): string {
  const n = Math.floor(r() * max);
  let s = "";
  for (let i = 0; i < n; i++) s += [...LETTERS][Math.floor(r() * [...LETTERS].length)];
  return s;
}

/** A random edit of `text`, made the way the textarea makes them: by diffing. */
function randomOp(r: () => number, text: string): TextOp {
  const chars = [...text];
  const at = Math.floor(r() * (chars.length + 1));
  const del = Math.floor(r() * (chars.length - at + 1) * (r() < 0.5 ? 1 : 0));
  const ins = r() < 0.7 ? randomText(r, 4) : "";
  const after = [...chars.slice(0, at), ins, ...chars.slice(at + del)].join("");
  return diffText(text, after, [...chars.slice(0, at), ins].join("").length);
}

describe("applyText", () => {
  it("keeps, inserts and deletes", () => {
    expect(applyText("hello world", [6, { d: 5 }, "there"])).toBe("hello there");
    expect(applyText("abc", ["x"])).toBe("xabc");
    expect(applyText("abc", [])).toBe("abc");
  });

  it("refuses an edit that runs past the end", () => {
    expect(() => applyText("abc", [2, { d: 2 }])).toThrow(RangeError);
    expect(() => applyText("abc", [4])).toThrow(RangeError);
  });
});

describe("diffText", () => {
  it("finds the one changed stretch", () => {
    expect(diffText("hello", "hello!")).toEqual([5, "!"]);
    expect(diffText("hello", "help")).toEqual([3, { d: 2 }, "p"]);
    expect(diffText("same", "same")).toEqual([]);
  });

  it("uses the caret to place an edit inside a run of one letter", () => {
    // Typed "a" between the two: caret ends at 2.
    expect(diffText("aa", "aaa", 2)).toEqual([1, "a"]);
    // Backspaced the first "a": caret ends at 0.
    expect(diffText("aaa", "aa", 0)).toEqual([{ d: 1 }]);
  });

  it("never splits an emoji", () => {
    const op = diffText("😀", "😃");
    expect(op).toEqual([{ d: 2 }, "😃"]);
    expect(applyText("😀", op)).toBe("😃");
  });

  it("always turns before into after", () => {
    const r = rng(1);
    for (let i = 0; i < 2000; i++) {
      const a = randomText(r);
      const b = randomText(r);
      const caret = Math.floor(r() * (b.length + 1));
      expect(applyText(a, diffText(a, b, caret))).toBe(b);
    }
  });
});

describe("transformText", () => {
  it("moves an insert past an earlier one", () => {
    // Both start from "hello". Alice adds "!" at the end, Bob "Oh, " at the start.
    const alice: TextOp = [5, "!"];
    const bob: TextOp = ["Oh, "];
    expect(transformText(alice, bob, "right")).toEqual([9, "!"]);
    expect(applyText(applyText("hello", bob), transformText(alice, bob, "right"))).toBe("Oh, hello!");
  });

  it("puts the left side first when both insert at one spot", () => {
    const first: TextOp = [2, "X"];
    const second: TextOp = [2, "Y"];
    const text = applyText(applyText("ab", first), transformText(second, first, "right"));
    expect(text).toBe("abXY");
    expect(applyText(applyText("ab", second), transformText(first, second, "left"))).toBe(text);
  });

  it("drops text typed inside a stretch someone else deleted, but keeps the typing", () => {
    // Alice deletes "bcd"; Bob types "Z" after "c".
    const alice: TextOp = [1, { d: 3 }];
    const bob: TextOp = [3, "Z"];
    const viaAlice = applyText(applyText("abcde", alice), transformText(bob, alice, "right"));
    const viaBob = applyText(applyText("abcde", bob), transformText(alice, bob, "left"));
    expect(viaAlice).toBe("aZe");
    expect(viaBob).toBe(viaAlice);
  });

  it("converges for any two edits of the same text", () => {
    const r = rng(2);
    for (let i = 0; i < 5000; i++) {
      const text = randomText(r);
      const a = randomOp(r, text);
      const b = randomOp(r, text);
      const one = applyText(applyText(text, a), transformText(b, a, "right"));
      const two = applyText(applyText(text, b), transformText(a, b, "left"));
      expect(two).toBe(one);
    }
  });
});

describe("composeText", () => {
  it("does one edit then the other", () => {
    const r = rng(3);
    for (let i = 0; i < 5000; i++) {
      const text = randomText(r);
      const a = randomOp(r, text);
      const mid = applyText(text, a);
      const b = randomOp(r, mid);
      expect(applyText(text, composeText(a, b))).toBe(applyText(mid, b));
    }
  });
});

describe("transformIndex", () => {
  it("follows the text around a position", () => {
    expect(transformIndex(3, ["ab"])).toBe(5);
    expect(transformIndex(3, [5, "ab"])).toBe(3);
    expect(transformIndex(3, [{ d: 2 }])).toBe(1);
    expect(transformIndex(3, [1, { d: 5 }])).toBe(1);
  });

  it("stays put when someone types right at it", () => {
    expect(transformIndex(3, [3, "xyz"])).toBe(3);
  });
});

describe("helpers", () => {
  it("normalizes and spots edits that change nothing", () => {
    expect(normalizeText([1, 2, "a", "b", { d: 1 }, { d: 0 }, 3])).toEqual([3, "ab", { d: 1 }]);
    expect(isNoopText([4])).toBe(true);
    expect(isNoopText([])).toBe(true);
    expect(isNoopText([1, "x"])).toBe(false);
  });
});

/**
 * The whole scheme end to end: a server that orders edits and keeps a short
 * history, and clients that each keep one edit in flight and buffer the
 * rest, exactly as the room and the session do. Messages arrive in random
 * order across clients but in order per client, like WebSockets.
 */
describe("several typists at once", () => {
  type Msg = { v: number; ops: TextOp; from: number };

  function simulate(seed: number) {
    const r = rng(seed);
    const server = { text: randomText(r), v: 0, history: [] as TextOp[] };
    const clients = [0, 1, 2].map((id) => ({
      id,
      known: server.text,
      v: 0,
      inflight: null as { base: number; ops: TextOp } | null,
      buffer: null as TextOp | null,
      inbox: [] as Msg[],
      local: server.text,
    }));
    const toServer: Array<{ from: number; base: number; ops: TextOp }> = [];

    function send(c: (typeof clients)[number]) {
      if (c.inflight || !c.buffer) return;
      c.inflight = { base: c.v, ops: c.buffer };
      c.buffer = null;
      toServer.push({ from: c.id, ...c.inflight });
    }

    function serverStep() {
      const m = toServer.shift();
      if (!m) return;
      let ops = m.ops;
      for (const past of server.history.slice(m.base)) ops = transformText(ops, past, "right");
      server.text = applyText(server.text, ops);
      server.v++;
      server.history.push(ops);
      for (const c of clients) c.inbox.push({ v: server.v, ops, from: m.from });
    }

    function clientStep(c: (typeof clients)[number]) {
      const m = c.inbox.shift();
      if (!m) return;
      c.known = applyText(c.known, m.ops);
      c.v = m.v;
      if (m.from === c.id) {
        c.inflight = null;
        send(c);
        return;
      }
      let incoming = m.ops;
      if (c.inflight) {
        const mine = c.inflight.ops;
        c.inflight.ops = transformText(mine, incoming, "right");
        incoming = transformText(incoming, mine, "left");
      }
      if (c.buffer) {
        const mine = c.buffer;
        c.buffer = transformText(mine, incoming, "right");
        incoming = transformText(incoming, mine, "left");
      }
      c.local = applyText(c.local, incoming);
    }

    for (let step = 0; step < 300; step++) {
      const c = clients[Math.floor(r() * clients.length)]!;
      const roll = r();
      if (roll < 0.35) {
        const op = randomOp(r, c.local);
        c.local = applyText(c.local, op);
        c.buffer = c.buffer ? composeText(c.buffer, op) : op;
        send(c);
      } else if (roll < 0.6) serverStep();
      else clientStep(c);
    }
    // Let everything arrive.
    while (toServer.length || clients.some((c) => c.inbox.length)) {
      serverStep();
      for (const c of clients) while (c.inbox.length) clientStep(c);
    }
    return { server, clients };
  }

  it("everyone ends with the same text", () => {
    for (let seed = 0; seed < 300; seed++) {
      const { server, clients } = simulate(seed);
      for (const c of clients) {
        expect(c.inflight).toBeNull();
        expect(c.buffer).toBeNull();
        expect(c.local).toBe(server.text);
        expect(c.known).toBe(server.text);
      }
    }
  });
});
