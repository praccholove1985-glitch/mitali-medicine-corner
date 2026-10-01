import { describe, expect, it } from "vitest";
import { amountToUnits, formatMoney, isValidAmount } from "./money";

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

describe("amounts", () => {
  it("validates non-negative amounts with up to four decimals", () => {
    for (const ok of ["0", "12", "12.5", "1.125", "0.0001", "9999999999.9999"]) {
      expect(isValidAmount(ok), ok).toBe(true);
    }
    for (const bad of ["", "-1", "1.", ".5", "1.12345", "1e3", "abc", "1,000", "12345678901"]) {
      expect(isValidAmount(bad), bad).toBe(false);
    }
  });

  it("converts to exact ten-thousandths", () => {
    expect(amountToUnits("1.5")).toBe(BigInt(15000));
    expect(amountToUnits("1.1250")).toBe(BigInt(11250));
    expect(amountToUnits("0.0001")).toBe(BigInt(1));
    expect(amountToUnits("x")).toBeNull();
  });

  it("compares amounts exactly where doubles would not", () => {
    // 0.1 + 0.2 !== 0.3 in floating point; as units they are exact.
    const sum = (amountToUnits("0.1") ?? BigInt(0)) + (amountToUnits("0.2") ?? BigInt(0));
    expect(sum).toBe(amountToUnits("0.3"));
  });
});
