import { describe, expect, it } from "vitest";
import { formatMoney } from "./money";

describe("formatMoney", () => {
  it("groups digits the Bangladeshi way", () => {
    expect(formatMoney("1234567.5")).toBe("৳12,34,567.50");
    expect(formatMoney("999")).toBe("৳999.00");
    expect(formatMoney("1000")).toBe("৳1,000.00");
    expect(formatMoney("100000")).toBe("৳1,00,000.00");
  });

  it("rounds half up without floating point", () => {
    expect(formatMoney("1.005")).toBe("৳1.01");
    expect(formatMoney("1.0049")).toBe("৳1.00");
    expect(formatMoney("0.995")).toBe("৳1.00");
    expect(formatMoney("999.999")).toBe("৳1,000.00");
  });

  it("keeps precision beyond what a double can hold", () => {
    expect(formatMoney("90071992547409.93")).toBe("৳9,00,71,99,25,47,409.93");
  });

  it("supports per-unit prices with more digits", () => {
    expect(formatMoney("1.125", { fractionDigits: 4 })).toBe("৳1.1250");
  });

  it("handles negatives and does not print negative zero", () => {
    expect(formatMoney("-250")).toBe("-৳250.00");
    expect(formatMoney("-0.001")).toBe("৳0.00");
  });

  it("can omit the symbol", () => {
    expect(formatMoney("5", { symbol: false })).toBe("5.00");
  });

  it("returns null for missing or invalid input instead of inventing a value", () => {
    expect(formatMoney(null)).toBeNull();
    expect(formatMoney(undefined)).toBeNull();
    expect(formatMoney("")).toBeNull();
    expect(formatMoney("abc")).toBeNull();
    expect(formatMoney("1e5")).toBeNull();
  });
});
