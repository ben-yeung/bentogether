import { describe, expect, it } from "vitest";
import { applyEdit, autoBullet, continueList, parseInline, parseNote } from "./markdown";

const typed = (before: string, after = "") => {
  const e = autoBullet(before + after, before.length);
  return e && applyEdit(before + after, e);
};
const enter = (before: string, after = "") => {
  const e = continueList(before + after, before.length, before.length);
  return e && applyEdit(before + after, e);
};

describe("autoBullet", () => {
  it("turns a dash or star at the start of a line into a bullet", () => {
    expect(typed("- ")).toEqual({ value: "• ", caret: 2 });
    expect(typed("Shopping\n  * ", "\nmore")).toEqual({ value: "Shopping\n  • \nmore", caret: 13 });
  });
  it("turns [ ] into a box to tick", () => {
    expect(typed("[ ] ")?.value).toBe("☐ ");
    expect(typed("• [] ")?.value).toBe("☐ ");
  });
  it("leaves dashes mid-line alone", () => {
    expect(typed("a - ")).toBeNull();
    expect(typed("-- ")).toBeNull();
  });
});

describe("continueList", () => {
  it("carries bullets, numbers and boxes on", () => {
    expect(enter("• milk")).toEqual({ value: "• milk\n• ", caret: 9 });
    expect(enter("  - eggs")?.value).toBe("  - eggs\n  - ");
    expect(enter("9. nine")?.value).toBe("9. nine\n10. ");
    expect(enter("☑ done")?.value).toBe("☑ done\n☐ ");
  });
  it("ends the list on an empty item", () => {
    expect(enter("• milk\n• ")).toEqual({ value: "• milk\n", caret: 7 });
  });
  it("splits an item when the caret is mid-line", () => {
    expect(enter("• ab", "cd")?.value).toBe("• ab\n• cd");
  });
  it("does nothing on plain lines", () => {
    expect(enter("hello")).toBeNull();
  });
});

describe("parseInline", () => {
  it("reads bold, italic, strike and code, nested", () => {
    expect(parseInline("a **b _c_** `d` ~~e~~ *f*")).toEqual([
      "a ",
      { style: "b", children: ["b ", { style: "i", children: ["c"] }] },
      " ",
      { style: "code", children: ["d"] },
      " ",
      { style: "s", children: ["e"] },
      " ",
      { style: "i", children: ["f"] },
    ]);
  });
  it("leaves lone stars and snake_case alone", () => {
    expect(parseInline("2 * 3 * 4 and snake_case_name")).toEqual(["2 * 3 * 4 and snake_case_name"]);
  });
});

describe("parseNote", () => {
  it("reads headings, lists, boxes and quotes", () => {
    const kinds = parseNote(
      "# Title\n## Sub\n• one\n  - two\n3. three\n[x] did\n☐ todo\n> said\nplain\n#tag",
    ).map((l) => [l.kind, "depth" in l ? l.depth : null, "done" in l ? l.done : null]);
    expect(kinds).toEqual([
      ["h1", null, null],
      ["h2", null, null],
      ["bullet", 0, null],
      ["bullet", 1, null],
      ["number", 0, null],
      ["check", 0, true],
      ["check", 0, false],
      ["quote", null, null],
      ["text", null, null],
      ["text", null, null],
    ]);
  });
});
