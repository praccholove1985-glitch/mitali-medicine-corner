import { describe, expect, it } from "vitest";
import { medicineFormSchema } from "@/lib/validation/medicine";
import { amountString, buildMedicinePayload } from "./medicine-payload";

const values = medicineFormSchema.parse({
  name: "Napa",
  unit: "pcs",
  mrp: "2.00",
  default_sale_price: "1.50",
  default_purchase_price: "1.1250",
  prescription_required: false,
  is_active: true,
});

describe("buildMedicinePayload", () => {
  it("leaves prices out when the form did not show them", () => {
    const payload = buildMedicinePayload(values, { includeSalePrice: false, includePurchasePrice: false });
    expect(payload).not.toHaveProperty("default_sale_price");
    expect(payload).not.toHaveProperty("default_purchase_price");
    expect(payload.mrp).toBe("2.00");
  });

  it("includes exactly the prices the user could edit", () => {
    const sale = buildMedicinePayload(values, { includeSalePrice: true, includePurchasePrice: false });
    expect(sale.default_sale_price).toBe("1.50");
    expect(sale).not.toHaveProperty("default_purchase_price");
    const both = buildMedicinePayload(values, { includeSalePrice: true, includePurchasePrice: true });
    expect(both.default_purchase_price).toBe("1.1250");
  });

  it("only sends fields save_medicine accepts", () => {
    const allowed = new Set([
      "name", "generic_name", "brand_name", "company_id", "category_id", "subcategory_id",
      "strength", "dosage_form", "unit", "pack_size", "barcode", "sku",
      "default_purchase_price", "default_sale_price", "mrp", "minimum_stock", "reorder_level",
      "prescription_required", "tax_rate", "description", "image_url", "is_active",
    ]);
    const payload = buildMedicinePayload(values, { includeSalePrice: true, includePurchasePrice: true });
    for (const key of Object.keys(payload)) expect(allowed.has(key), key).toBe(true);
  });
});

describe("amountString", () => {
  it("passes strings through and stringifies numbers without changing digits", () => {
    expect(amountString("1.1250")).toBe("1.1250");
    expect(amountString(1.125)).toBe("1.125");
    expect(amountString(1.5)).toBe("1.5");
    expect(amountString(null)).toBeNull();
    expect(amountString(undefined)).toBeNull();
  });
});
