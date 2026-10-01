import { describe, expect, it } from "vitest";
import { cartItemsSchema, completeSaleSchema, customerSchema, draftSchema, paymentSchema } from "./sale";

const id = "11111111-1111-1111-1111-111111111111";
const item = { medicine_id: id, quantity: 2 };

describe("paymentSchema", () => {
  it("accepts every method and exact amounts", () => {
    for (const method of ["CASH", "BKASH", "NAGAD", "ROCKET", "CARD", "BANK", "CREDIT"]) {
      expect(paymentSchema.safeParse({ method, amount: "10.50" }).success, method).toBe(true);
    }
  });
  it("rejects what the database would reject", () => {
    for (const amount of ["", "0", "0.00", "-5", "1.234", "1,000", "abc", "1e3"]) {
      expect(paymentSchema.safeParse({ method: "CASH", amount }).success, amount).toBe(false);
    }
    expect(paymentSchema.safeParse({ method: "CHEQUE", amount: "5" }).success).toBe(false);
  });
});

describe("cartItemsSchema", () => {
  it("needs between 1 and 100 lines", () => {
    expect(cartItemsSchema.safeParse([]).success).toBe(false);
    expect(cartItemsSchema.safeParse([item]).success).toBe(true);
    expect(cartItemsSchema.safeParse(Array(101).fill(item)).success).toBe(false);
  });
  it("bounds the quantity", () => {
    expect(cartItemsSchema.safeParse([{ ...item, quantity: 0 }]).success).toBe(false);
    expect(cartItemsSchema.safeParse([{ ...item, quantity: 1.5 }]).success).toBe(false);
    expect(cartItemsSchema.safeParse([{ ...item, quantity: 100001 }]).success).toBe(false);
  });
  it("strips a smuggled price (prices are never accepted from the browser)", () => {
    const parsed = cartItemsSchema.parse([{ ...item, unit_price: "0.01", price: 1 }]);
    expect(parsed[0]).not.toHaveProperty("unit_price");
    expect(parsed[0]).not.toHaveProperty("price");
  });
});

describe("completeSaleSchema", () => {
  const sale = { clientRequestId: id, customerId: null, items: [item], payments: [{ method: "CASH", amount: "100.00" }] };
  it("accepts a normal sale and a walk-in", () => {
    expect(completeSaleSchema.safeParse(sale).success).toBe(true);
  });
  it("needs a request id for idempotency", () => {
    expect(completeSaleSchema.safeParse({ ...sale, clientRequestId: "" }).success).toBe(false);
  });
  it("allows an empty payment list (a free sale); the database checks the total", () => {
    expect(completeSaleSchema.safeParse({ ...sale, payments: [] }).success).toBe(true);
  });
  it("caps the number of payment rows", () => {
    expect(completeSaleSchema.safeParse({ ...sale, payments: Array(13).fill({ method: "CASH", amount: "1" }) }).success).toBe(false);
  });
});

describe("draftSchema and customerSchema", () => {
  it("validates drafts", () => {
    expect(draftSchema.safeParse({ customerId: null, items: [item] }).success).toBe(true);
    expect(draftSchema.safeParse({ customerId: null, items: [] }).success).toBe(false);
  });
  it("trims and normalises customers", () => {
    expect(customerSchema.parse({ name: "  Karim ", phone: "  ", address: "" })).toEqual({ name: "Karim", phone: undefined, address: undefined });
    expect(customerSchema.safeParse({ name: "  " }).success).toBe(false);
  });
});
