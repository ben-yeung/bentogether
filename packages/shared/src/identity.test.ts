import { describe, expect, it } from "vitest";
import { ID_PATTERN, parseClientMessage } from "./protocol";
import {
  MIN_HUE_GAP,
  PERSON_HUES,
  hueDistance,
  identityFromSeed,
  personTone,
  randomId,
  sameName,
  separateHue,
} from "./identity";

describe("separateHue", () => {
  it("keeps your palette color when it's free, snapping odd hues onto the palette", () => {
    expect(separateHue(210, [10, 90])).toBe(210);
    expect(separateHue(207, [])).toBe(210);
  });

  it("never gives you the color someone at the table already has", () => {
    const hue = separateHue(110, [108]);
    expect(hue).not.toBe(personTone(108).h);
    expect(hueDistance(hue, 110)).toBeGreaterThanOrEqual(MIN_HUE_GAP);
  });

  it("gives a full table of 18 all different colors", () => {
    const taken: number[] = [];
    for (let i = 0; i < 18; i++) taken.push(separateHue(50, taken));
    expect(new Set(taken).size).toBe(18);
    expect(taken.every((h) => PERSON_HUES.includes(h))).toBe(true);
  });

  it("spreads a small table far apart", () => {
    const taken: number[] = [];
    for (let i = 0; i < 4; i++) taken.push(separateHue(50, taken));
    for (let i = 0; i < taken.length; i++)
      for (let j = i + 1; j < taken.length; j++)
        expect(hueDistance(taken[i]!, taken[j]!)).toBeGreaterThanOrEqual(80);
  });

  it("maps any hue to a palette tone", () => {
    expect(personTone(95).h).toBe(90);
    expect(personTone(359).h).toBe(350);
  });
});

describe("identityFromSeed", () => {
  it("is stable for a seed", () => {
    expect(identityFromSeed(1234)).toEqual(identityFromSeed(1234));
  });
});

describe("randomId", () => {
  it("matches the id pattern", () => {
    for (let i = 0; i < 50; i++) expect(randomId()).toMatch(ID_PATTERN);
  });
});

describe("parseClientMessage", () => {
  it("accepts a valid op", () => {
    const res = parseClientMessage({
      t: "op",
      opId: "o1",
      op: {
        type: "create",
        id: "abcdefgh1234",
        kind: "note",
        rect: { x: 0, y: 0, w: 3, h: 3 },
        color: "tamago",
      },
    });
    expect(res.success).toBe(true);
    if (
      res.success &&
      res.output.t === "op" &&
      res.output.op.type === "create" &&
      res.output.op.kind === "note"
    )
      expect(res.output.op.text).toBe("");
  });

  it("rejects out-of-grid rects and unknown colors", () => {
    expect(
      parseClientMessage({
        t: "op",
        opId: "o",
        op: { type: "move", id: "abcdefgh", rect: { x: 40, y: 0, w: 3, h: 3 } },
      }).success,
    ).toBe(false);
    expect(
      parseClientMessage({ t: "op", opId: "o", op: { type: "patch", id: "abcdefgh", color: "red" } }).success,
    ).toBe(false);
  });

  it("trims and bounds names", () => {
    const ok = parseClientMessage({ t: "rename", name: "  Mochi  " });
    expect(ok.success && ok.output.t === "rename" && ok.output.name).toBe("Mochi");
    expect(parseClientMessage({ t: "rename", name: "x".repeat(40) }).success).toBe(false);
  });
});

describe("sameName", () => {
  it("ignores case, spacing at the ends and full-width look-alikes", () => {
    expect(sameName("Mochi", " mochi ")).toBe(true);
    expect(sameName("Mochi", "Ｍｏｃｈｉ")).toBe(true);
    expect(sameName("Mochi", "Mochi-san")).toBe(false);
  });
});
