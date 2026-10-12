import { describe, expect, it } from "vitest";
import { createPurchaseSchema, purchaseLineSchema } from "./purchase";

const MED = "f1000000-0000-0000-0000-0000000000a1";
const line = { medicine_id: MED, batch_number: "B1", expiry_date: "2027-03-31", quantity: 10, free_quantity: 2, unit_price: "10.50" };

describe("purchaseLineSchema", () => {
  it("accepts a normal line", () => {
    expect(purchaseLineSchema.safeParse(line).success).toBe(true);
  });
  it("trims the batch number and requires one", () => {
    expect(purchaseLineSchema.parse({ ...line, batch_number: "  B1 " }).batch_number).toBe("B1");
    expect(purchaseLineSchema.safeParse({ ...line, batch_number: "  " }).success).toBe(false);
  });
  it("counts free units: free-only is fine, nothing at all is not", () => {
    expect(purchaseLineSchema.safeParse({ ...line, quantity: 0, free_quantity: 5 }).success).toBe(true);
    expect(purchaseLineSchema.safeParse({ ...line, quantity: 0, free_quantity: 0 }).success).toBe(false);
  });
  it("needs whole, non-negative units", () => {
    expect(purchaseLineSchema.safeParse({ ...line, quantity: 1.5 }).success).toBe(false);
    expect(purchaseLineSchema.safeParse({ ...line, quantity: -1 }).success).toBe(false);
  });
  it("keeps prices as strings with at most 4 decimals", () => {
    expect(purchaseLineSchema.safeParse({ ...line, unit_price: "0.3333" }).success).toBe(true);
    for (const bad of ["1.00001", "-1", "abc", "", "1e3", "1,5"]) {
      expect(purchaseLineSchema.safeParse({ ...line, unit_price: bad }).success, bad).toBe(false);
    }
    expect(purchaseLineSchema.safeParse({ ...line, unit_price: 10.5 }).success).toBe(false);
  });
  it("rejects impossible dates", () => {
    expect(purchaseLineSchema.safeParse({ ...line, expiry_date: "2027-02-31" }).success).toBe(false);
    expect(purchaseLineSchema.safeParse({ ...line, expiry_date: "next year" }).success).toBe(false);
  });
  it("limits discount and tax text", () => {
    expect(purchaseLineSchema.safeParse({ ...line, discount_type: "PERCENT", discount_value: "10", tax_rate: "5.5" }).success).toBe(true);
    expect(purchaseLineSchema.safeParse({ ...line, tax_rate: "5.555" }).success).toBe(false);
    expect(purchaseLineSchema.safeParse({ ...line, discount_type: "BOGUS" }).success).toBe(false);
  });
  it("has no client line total: an extra one is stripped, never passed on", () => {
    const r = purchaseLineSchema.parse({ ...line, line_total: "1.00" });
    expect("line_total" in r).toBe(false);
  });
});

describe("createPurchaseSchema", () => {
  const base = {
    clientRequestId: "aaaaaaaa-1111-0000-0000-000000000001",
    supplierId: "a1000000-0000-0000-0000-0000000000f1",
    supplierInvoiceNo: " SQ-1001 ",
    invoiceDate: "2026-10-01",
    items: [line],
    payments: [{ method: "CASH", amount: "40.00" }],
  };
  it("accepts a purchase and trims the invoice number", () => {
    const r = createPurchaseSchema.parse(base);
    expect(r.supplierInvoiceNo).toBe("SQ-1001");
  });
  it("requires lines and an invoice number", () => {
    expect(createPurchaseSchema.safeParse({ ...base, items: [] }).success).toBe(false);
    expect(createPurchaseSchema.safeParse({ ...base, supplierInvoiceNo: " " }).success).toBe(false);
  });
  it("allows no payments (everything stays owed) but not credit as a payment", () => {
    expect(createPurchaseSchema.safeParse({ ...base, payments: [] }).success).toBe(true);
    expect(createPurchaseSchema.safeParse({ ...base, payments: [{ method: "CREDIT", amount: "5" }] }).success).toBe(false);
  });
  it("rejects bad payment amounts", () => {
    for (const bad of ["0", "-1", "1.005", "x"]) {
      expect(createPurchaseSchema.safeParse({ ...base, payments: [{ method: "CASH", amount: bad }] }).success, bad).toBe(false);
    }
  });
});
