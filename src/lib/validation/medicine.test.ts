import { describe, expect, it } from "vitest";
import { batchFormSchema, batchPriceSchema, firstErrorPerField, medicineFormSchema } from "./medicine";

const base = {
  name: "Napa",
  unit: "pcs",
  prescription_required: false,
  is_active: true,
};

describe("medicineFormSchema", () => {
  it("accepts a name alone and fills defaults", () => {
    const parsed = medicineFormSchema.parse(base);
    expect(parsed).toMatchObject({
      name: "Napa",
      pack_size: 1,
      minimum_stock: 0,
      reorder_level: 0,
      tax_rate: "0",
      default_sale_price: null,
      mrp: null,
      barcode: null,
    });
  });

  it("keeps amounts as exact strings, never numbers", () => {
    const parsed = medicineFormSchema.parse({ ...base, default_purchase_price: "1.1250", mrp: "2", default_sale_price: "1.50" });
    expect(parsed.default_purchase_price).toBe("1.1250");
    expect(typeof parsed.mrp).toBe("string");
  });

  it("turns blank optional text into null", () => {
    const parsed = medicineFormSchema.parse({ ...base, generic_name: "   ", barcode: "" });
    expect(parsed.generic_name).toBeNull();
    expect(parsed.barcode).toBeNull();
  });

  it("rejects a missing name and bad numbers with readable messages", () => {
    const result = medicineFormSchema.safeParse({ ...base, name: " ", pack_size: "ten", mrp: "1,5", tax_rate: "150" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = firstErrorPerField(result.error);
      expect(errors.name).toMatch(/medicine name/i);
      expect(errors.pack_size).toMatch(/whole number/i);
      expect(errors.mrp).toMatch(/amount like/i);
      expect(errors.tax_rate).toBeDefined();
    }
  });

  it("rejects a sale price above the MRP using exact comparison", () => {
    const bad = medicineFormSchema.safeParse({ ...base, mrp: "2.00", default_sale_price: "2.0001" });
    expect(bad.success).toBe(false);
    const equal = medicineFormSchema.safeParse({ ...base, mrp: "2.00", default_sale_price: "2" });
    expect(equal.success).toBe(true);
  });

  it("requires a category when a subcategory is chosen", () => {
    const id = "11111111-1111-1111-1111-111111111111";
    const result = medicineFormSchema.safeParse({ ...base, subcategory_id: id });
    expect(result.success).toBe(false);
  });

  it("rejects a pack size of zero", () => {
    expect(medicineFormSchema.safeParse({ ...base, pack_size: "0" }).success).toBe(false);
  });
});

describe("batchFormSchema", () => {
  const batch = {
    medicine_id: "11111111-1111-1111-1111-111111111111",
    batch_number: "A",
    expiry_date: "2027-03-31",
    quantity: "40",
    purchase_price: "1.10",
    sale_price: "1.50",
    mrp: "2.00",
  };

  it("accepts the brief's example batch", () => {
    expect(batchFormSchema.parse(batch)).toMatchObject({ quantity: "40", purchase_price: "1.10", mrp: "2.00" });
  });

  it("requires a positive whole quantity", () => {
    expect(batchFormSchema.safeParse({ ...batch, quantity: "0" }).success).toBe(false);
    expect(batchFormSchema.safeParse({ ...batch, quantity: "2.5" }).success).toBe(false);
    expect(batchFormSchema.safeParse({ ...batch, quantity: "-3" }).success).toBe(false);
  });

  it("requires a date and prices", () => {
    expect(batchFormSchema.safeParse({ ...batch, expiry_date: "" }).success).toBe(false);
    expect(batchFormSchema.safeParse({ ...batch, purchase_price: "" }).success).toBe(false);
    expect(batchFormSchema.safeParse({ ...batch, sale_price: "abc" }).success).toBe(false);
  });

  it("rejects a sale price above the MRP", () => {
    expect(batchFormSchema.safeParse({ ...batch, sale_price: "2.01" }).success).toBe(false);
  });

  it("allows no MRP", () => {
    expect(batchFormSchema.parse({ ...batch, mrp: "" }).mrp).toBeNull();
  });
});

describe("batchPriceSchema", () => {
  it("checks sale price against MRP", () => {
    const id = "11111111-1111-1111-1111-111111111111";
    expect(batchPriceSchema.safeParse({ batch_id: id, sale_price: "3", mrp: "2" }).success).toBe(false);
    expect(batchPriceSchema.safeParse({ batch_id: id, sale_price: "1.4", mrp: "2" }).success).toBe(true);
  });
});
