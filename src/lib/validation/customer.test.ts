import { describe, expect, it } from "vitest";
import { customerFormSchema, parseStatementRange, receivePaymentSchema } from "./customer";

const ID = "d1000000-0000-0000-0000-0000000000c1";
const REQ = "aaaaaaaa-1111-0000-0000-000000000001";

describe("customerFormSchema", () => {
  it("trims, and turns empty optional fields into undefined", () => {
    const r = customerFormSchema.parse({ name: "  Karim ", phone: "", address: " ", credit_limit: "" });
    expect(r).toEqual({ name: "Karim", phone: undefined, address: undefined, credit_limit: undefined });
  });
  it("requires a name", () => {
    expect(customerFormSchema.safeParse({ name: "  " }).success).toBe(false);
  });
  it("accepts local and international phone formats, rejects letters", () => {
    expect(customerFormSchema.safeParse({ name: "A", phone: "01711-111111" }).success).toBe(true);
    expect(customerFormSchema.safeParse({ name: "A", phone: "+880 1711 111111" }).success).toBe(true);
    expect(customerFormSchema.safeParse({ name: "A", phone: "call me" }).success).toBe(false);
  });
  it("accepts a credit limit with up to two decimals, including 0", () => {
    expect(customerFormSchema.safeParse({ name: "A", credit_limit: "0" }).success).toBe(true);
    expect(customerFormSchema.safeParse({ name: "A", credit_limit: "1500.50" }).success).toBe(true);
  });
  it("rejects a third decimal, negatives and text for the credit limit", () => {
    for (const bad of ["10.005", "-5", "abc", "1e3"]) {
      expect(customerFormSchema.safeParse({ name: "A", credit_limit: bad }).success, bad).toBe(false);
    }
  });
  it("has no balance field: an extra balance is stripped, never passed on", () => {
    const r = customerFormSchema.parse({ name: "A", balance: "999" });
    expect("balance" in r).toBe(false);
  });
});

describe("receivePaymentSchema", () => {
  const base = { customer_id: ID, client_request_id: REQ, method: "CASH", amount: "150.00" };
  it("accepts a normal payment", () => {
    expect(receivePaymentSchema.safeParse(base).success).toBe(true);
  });
  it("rejects credit and unknown methods: only money methods pay a due", () => {
    expect(receivePaymentSchema.safeParse({ ...base, method: "CREDIT" }).success).toBe(false);
    expect(receivePaymentSchema.safeParse({ ...base, method: "GOLD" }).success).toBe(false);
  });
  it("rejects zero, negative, three decimals and text amounts", () => {
    for (const bad of ["0", "0.00", "-5", "1.005", "abc", "", "1,000"]) {
      expect(receivePaymentSchema.safeParse({ ...base, amount: bad }).success, bad).toBe(false);
    }
  });
  it("accepts 0.01, the smallest payment", () => {
    expect(receivePaymentSchema.safeParse({ ...base, amount: "0.01" }).success).toBe(true);
  });
  it("limits the reference and note lengths", () => {
    expect(receivePaymentSchema.safeParse({ ...base, reference: "x".repeat(65) }).success).toBe(false);
    expect(receivePaymentSchema.safeParse({ ...base, note: "x".repeat(301) }).success).toBe(false);
  });
});

describe("parseStatementRange", () => {
  const defaults = { from: "2026-10-01", to: "2026-10-31" };
  it("uses a valid range from the URL", () => {
    expect(parseStatementRange("2026-09-01", "2026-09-30", defaults)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });
  it("falls back for missing, malformed, impossible or reversed dates", () => {
    expect(parseStatementRange(undefined, undefined, defaults)).toEqual(defaults);
    expect(parseStatementRange("yesterday", "2026-09-30", defaults)).toEqual(defaults);
    expect(parseStatementRange("2026-02-31", "2026-09-30", defaults)).toEqual(defaults);
    expect(parseStatementRange("2026-09-30", "2026-09-01", defaults)).toEqual(defaults);
  });
  it("falls back for a range longer than ten years", () => {
    expect(parseStatementRange("2010-01-01", "2026-09-30", defaults)).toEqual(defaults);
  });
  it("accepts a single day", () => {
    expect(parseStatementRange("2026-09-05", "2026-09-05", defaults)).toEqual({ from: "2026-09-05", to: "2026-09-05" });
  });
});
