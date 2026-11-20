import { describe, expect, it } from "vitest";
import { applyWidgetChange, blankFields, timerLeft, type ChangeCtx } from "./changes";
import { bitsToSlots, shiftSlots, slotsToBits } from "./freetimes";
import { FREE_SLOTS, type PollWidget, type TimerWidget, type Widget, type WidgetChange } from "./protocol";

const frame = {
  id: "wid00001",
  x: 0,
  y: 0,
  w: 3,
  h: 3,
  title: "",
  color: "nori",
  createdBy: "Mochi",
  createdAt: 0,
  updatedAt: 0,
} as const;
const ctx = (now = 0, voter = "voter1"): ChangeCtx => ({ name: "Mochi", hue: 10, voter, now });
function apply<W extends Widget>(w: W, c: WidgetChange, at = ctx()): W {
  const out = applyWidgetChange(w, c, at);
  if ("code" in out) throw new Error(out.message);
  return out as W;
}

describe("timer", () => {
  const timer = { ...frame, ...blankFields("timer", 0) } as unknown as TimerWidget;

  it("adds time while running and restarts once it's finished", () => {
    let t = apply(timer, { kind: "timer", do: "set", ms: 10_000 });
    t = apply(t, { kind: "timer", do: "start" }, ctx(1_000));
    t = apply(t, { kind: "timer", do: "add", ms: 60_000 }, ctx(2_000));
    expect(timerLeft(t, 2_000)).toBe(69_000);
    // Long finished: start runs the full length again.
    t = apply(t, { kind: "timer", do: "start" }, ctx(500_000));
    expect(timerLeft(t, 500_000)).toBe(10_000);
  });

  it("never goes below zero", () => {
    const t = apply(timer, { kind: "timer", do: "add", ms: -10 * 60_000 });
    expect(t.left).toBe(0);
  });
});

describe("poll", () => {
  let poll = { ...frame, ...blankFields("poll", 0) } as unknown as PollWidget;
  for (const id of ["opt00001", "opt00002"])
    poll = apply(poll, { kind: "poll", do: "addOption", optionId: id, text: id });

  it("keeps one pick unless several are allowed, and narrows back to one", () => {
    let p = apply(poll, { kind: "poll", do: "vote", picks: ["opt00001", "opt00002"] });
    expect(p.votes.voter1!.picks).toEqual(["opt00002"]);
    p = apply(p, { kind: "poll", do: "setMulti", multi: true });
    p = apply(p, { kind: "poll", do: "vote", picks: ["opt00001", "opt00002"] });
    expect(p.votes.voter1!.picks).toEqual(["opt00001", "opt00002"]);
    p = apply(p, { kind: "poll", do: "setMulti", multi: false });
    expect(p.votes.voter1!.picks).toEqual(["opt00002"]);
  });

  it("drops a removed option from everyone's picks, and an empty vote takes it back", () => {
    let p = apply(poll, { kind: "poll", do: "vote", picks: ["opt00001"] });
    p = apply(p, { kind: "poll", do: "removeOption", optionId: "opt00001" });
    expect(p.votes.voter1!.picks).toEqual([]);
    p = apply(p, { kind: "poll", do: "vote", picks: [] });
    expect(p.votes.voter1).toBeUndefined();
  });
});

describe("free-time slots", () => {
  it("round-trip through hex and shift by whole slots", () => {
    const bits = Array<boolean>(FREE_SLOTS).fill(false);
    bits[0] = bits[100] = bits[FREE_SLOTS - 1] = true;
    const hex = bitsToSlots(bits);
    expect(slotsToBits(hex)).toEqual(bits);
    const shifted = slotsToBits(shiftSlots(hex, 48));
    expect(shifted.indexOf(true)).toBe(52);
    expect(shifted.filter(Boolean)).toHaveLength(2);
  });
});
