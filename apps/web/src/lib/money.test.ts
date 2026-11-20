import { describe, expect, it } from "vitest";
import { currencyDigits, editableAmount, formatMoney, parseAmount } from "./money";

describe("money", () => {
  it("knows which currencies have decimals", () => {
    expect(currencyDigits("USD")).toBe(2);
    expect(currencyDigits("JPY")).toBe(0);
  });

  it("formats round amounts short and keeps cents when there are any", () => {
    expect(formatMoney(125000, "USD")).toMatch(/1,?250$/);
    expect(formatMoney(1250, "USD")).toMatch(/12\.50$/);
    expect(formatMoney(-2000, "USD")).toMatch(/^−/);
    expect(formatMoney(2000, "USD", { signed: true })).toMatch(/^\+/);
  });

  it("gives a plain number to edit", () => {
    expect(editableAmount(125000, "USD")).toBe("1250");
    expect(editableAmount(1250, "USD")).toBe("12.50");
    expect(editableAmount(50000, "JPY")).toBe("500");
  });

  it("reads typed amounts in either number style", () => {
    expect(parseAmount("20", "USD")).toEqual({ hundredths: 2000, sign: null });
    expect(parseAmount("-20", "USD")).toEqual({ hundredths: 2000, sign: "-" });
    expect(parseAmount("+1,250.50", "USD")).toEqual({ hundredths: 125050, sign: "+" });
    expect(parseAmount("1.250,50", "EUR")).toEqual({ hundredths: 125050, sign: null });
    expect(parseAmount("$12.5", "USD")).toEqual({ hundredths: 1250, sign: null });
    expect(parseAmount("1,000", "USD")).toEqual({ hundredths: 100000, sign: null });
    expect(parseAmount("¥1,500", "JPY")).toEqual({ hundredths: 150000, sign: null });
    expect(parseAmount("lunch", "USD")).toBeNull();
  });
});
