import { describe, expect, it } from "vitest";
import { parseClientMessage } from "./protocol";
import { applyTodoChange } from "./todo";

const op = (o: unknown) => parseClientMessage({ t: "op", opId: "o1", op: o });

describe("to-do on the wire", () => {
  it("parses a to-do create with a default title", () => {
    const res = op({
      type: "create",
      id: "abcdefgh1234",
      kind: "todo",
      rect: { x: 0, y: 0, w: 3, h: 4 },
      color: "nori",
    });
    expect(res.success && res.output.t === "op" && res.output.op).toMatchObject({ kind: "todo", title: "" });
  });

  it("parses item changes and rejects blank or unknown ones", () => {
    expect(
      op({ type: "item", id: "abcdefgh", change: { do: "add", itemId: "item0001", text: "Rice" } }).success,
    ).toBe(true);
    expect(
      op({ type: "item", id: "abcdefgh", change: { do: "add", itemId: "item0001", text: "   " } }).success,
    ).toBe(false);
    expect(op({ type: "item", id: "abcdefgh", change: { do: "shred" } }).success).toBe(false);
  });
});

describe("applyTodoChange", () => {
  it("is pure: the input list is left alone", () => {
    const items = [{ id: "item0001", text: "Rice", done: false, by: "Mochi", at: 1 }];
    const res = applyTodoChange(items, { do: "check", itemId: "item0001", done: true }, "Nori", 2);
    expect("items" in res && res.items[0]!.done).toBe(true);
    expect(items[0]!.done).toBe(false);
  });
});
