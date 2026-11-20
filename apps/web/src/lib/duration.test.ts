import { describe, expect, it } from "vitest";
import { formatDuration, parseDuration } from "./duration";

describe("formatDuration", () => {
  it("shows minutes and seconds, hours when there are any", () => {
    expect(formatDuration(300_000)).toBe("5:00");
    expect(formatDuration(299_001)).toBe("5:00");
    expect(formatDuration(59_000)).toBe("0:59");
    expect(formatDuration(3_723_000)).toBe("1:02:03");
    expect(formatDuration(-5)).toBe("0:00");
  });
});

describe("parseDuration", () => {
  it("reads minutes, clock forms and units", () => {
    expect(parseDuration("25")).toBe(25 * 60_000);
    expect(parseDuration("1:30")).toBe(90_000);
    expect(parseDuration("1:00:00")).toBe(3_600_000);
    expect(parseDuration("90s")).toBe(90_000);
    expect(parseDuration("1h30m")).toBe(5_400_000);
    expect(parseDuration("2 min")).toBe(120_000);
  });
  it("refuses what isn't a length", () => {
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("soon")).toBeNull();
    expect(parseDuration("1:75")).toBeNull();
  });
});
