import { describe, expect, it } from "vitest";
import { addDays, addMonths, dateOfMinute, minuteOf, monthGrid, startOfWeek, timeOfMinute } from "./dates";

describe("plain dates", () => {
  it("steps days and months, clamping to the month's end", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
  });

  it("finds the week and the month grid", () => {
    expect(startOfWeek("2026-11-20")).toBe("2026-11-15");
    const grid = monthGrid("2026-11-20");
    expect(grid).toHaveLength(42);
    expect(grid[0]).toBe("2026-11-01");
    expect(grid).toContain("2026-11-30");
  });

  it("round-trips a local date and time through UTC minutes", () => {
    const m = minuteOf("2026-11-20", "14:30");
    expect(dateOfMinute(m)).toBe("2026-11-20");
    expect(timeOfMinute(m)).toBe("14:30");
  });
});
