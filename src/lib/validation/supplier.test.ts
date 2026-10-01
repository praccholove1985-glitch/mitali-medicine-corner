import { describe, expect, it } from "vitest";
import { paySupplierSchema, supplierFormSchema } from "./supplier";

const ID = "a1000000-0000-0000-0000-0000000000f1";
const REQ = "aaaaaaaa-1111-0000-0000-000000000001";

describe("supplierFormSchema", () => {
  it("trims and drops empty optional fields", () => {
    expect(supplierFormSchema.parse({ name: "  Square ", contact_person: " ", phone: "", address: "" })).toEqual({
      name: "Square",
      contact_person: undefined,
      phone: undefined,
      address: undefined,
    });
  });
  it("requires a name and sane phone", () => {
    expect(supplierFormSchema.safeParse({ name: " " }).success).toBe(false);
    expect(supplierFormSchema.safeParse({ name: "A", phone: "abc" }).success).toBe(false);
    expect(supplierFormSchema.safeParse({ name: "A", phone: "+880 1711-111111" }).success).toBe(true);
  });
  it("has no balance field: an extra one is stripped", () => {
    expect("balance" in supplierFormSchema.parse({ name: "A", balance: "5" })).toBe(false);
  });
});

describe("paySupplierSchema", () => {
  const base = { supplier_id: ID, client_request_id: REQ, method: "BANK", amount: "50.00" };
  it("accepts a normal payment and the smallest one", () => {
    expect(paySupplierSchema.safeParse(base).success).toBe(true);
    expect(paySupplierSchema.safeParse({ ...base, amount: "0.01" }).success).toBe(true);
  });
  it("rejects credit, zero, negative, three decimals and text", () => {
    expect(paySupplierSchema.safeParse({ ...base, method: "CREDIT" }).success).toBe(false);
    for (const bad of ["0", "-5", "1.005", "abc", "", "1,000"]) {
      expect(paySupplierSchema.safeParse({ ...base, amount: bad }).success, bad).toBe(false);
    }
  });
});
