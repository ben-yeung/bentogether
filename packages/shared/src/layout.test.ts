import { describe, expect, it } from "vitest";
import { changedIds, findSpot, overlaps, settle, type Placed } from "./layout";

const p = (id: string, x: number, y: number, w = 2, h = 2): Placed => ({ id, x, y, w, h });

function noOverlaps(items: Placed[]) {
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) expect(overlaps(items[i]!, items[j]!)).toBe(false);
}

describe("overlaps", () => {
  it("treats touching edges as not overlapping", () => {
    expect(overlaps(p("a", 0, 0), p("b", 2, 0))).toBe(false);
    expect(overlaps(p("a", 0, 0), p("b", 0, 2))).toBe(false);
    expect(overlaps(p("a", 0, 0), p("b", 1, 1))).toBe(true);
  });
});

describe("settle", () => {
  it("floats everything up to rest on something", () => {
    const out = settle([p("a", 0, 5), p("b", 0, 9)]);
    expect(out).toEqual([p("a", 0, 0), p("b", 0, 2)]);
  });

  it("keeps the anchor where it was dropped and pushes others below it", () => {
    // b dropped onto a: b keeps its spot, a moves under it.
    const out = settle([p("a", 0, 0), p("b", 0, 0)], "b");
    expect(out.find((i) => i.id === "b")).toEqual(p("b", 0, 0));
    expect(out.find((i) => i.id === "a")).toEqual(p("a", 0, 2));
  });

  it("cascades pushes through a column", () => {
    const out = settle([p("a", 0, 0), p("b", 0, 2), p("c", 0, 4), p("n", 0, 1)], "n");
    noOverlaps(out);
    expect(out.map((i) => i.id + i.y).join(" ")).toBe("a2 b4 c6 n0");
  });

  it("preserves input order in the result", () => {
    const input = [p("z", 4, 4), p("a", 0, 0)];
    expect(settle(input).map((i) => i.id)).toEqual(["z", "a"]);
  });

  it("is deterministic for ties", () => {
    const a = settle([p("b", 0, 0), p("a", 0, 0)]);
    const b = settle([p("a", 0, 0), p("b", 0, 0)]);
    expect(new Map(a.map((i) => [i.id, i.y]))).toEqual(new Map(b.map((i) => [i.id, i.y])));
  });

  it("never produces overlaps on a crowded random box", () => {
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const items = Array.from({ length: 40 }, (_, i) =>
      p(
        `n${i}`,
        Math.floor(rand() * 10),
        Math.floor(rand() * 20),
        2 + Math.floor(rand() * 3),
        2 + Math.floor(rand() * 3),
      ),
    ).map((i) => ({ ...i, x: Math.min(i.x, 12 - i.w) }));
    noOverlaps(settle(items, "n3"));
  });
});

describe("settle without gravity", () => {
  it("leaves gaps alone and still makes room for a drop", () => {
    expect(settle([p("a", 0, 5)], undefined, { gravity: false })).toEqual([p("a", 0, 5)]);
    const out = settle([p("a", 0, 0), p("b", 0, 0)], "b", { gravity: false });
    expect(out.find((i) => i.id === "a")).toEqual(p("a", 0, 2));
  });
});

describe("findSpot", () => {
  it("fills the first free gap in reading order", () => {
    expect(findSpot([p("a", 0, 0, 3, 3)], 3, 3)).toEqual({ x: 3, y: 0, w: 3, h: 3 });
    expect(findSpot([p("a", 0, 0, 12, 2)], 3, 3)).toEqual({ x: 0, y: 2, w: 3, h: 3 });
  });
});

describe("changedIds", () => {
  it("lists only moved compartments", () => {
    expect(changedIds([p("a", 0, 0), p("b", 2, 0)], [p("a", 0, 0), p("b", 2, 3)])).toEqual(["b"]);
  });
});
