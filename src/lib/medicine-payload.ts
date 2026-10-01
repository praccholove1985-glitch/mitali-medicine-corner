import type { MedicineFormValues } from "@/lib/validation/medicine";

export type MedicinePayloadOptions = {
  /** The user could see and edit sale price; omit otherwise so prices are left alone. */
  includeSalePrice: boolean;
  /** The user could see and edit the purchase price. */
  includePurchasePrice: boolean;
};

/**
 * The JSON sent to public.save_medicine. Prices are only included when the form
 * showed them, so a pharmacist who cannot see prices never overwrites them with
 * blanks. Amounts stay as exact strings.
 */
export function buildMedicinePayload(
  values: MedicineFormValues,
  { includeSalePrice, includePurchasePrice }: MedicinePayloadOptions,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name: values.name,
    generic_name: values.generic_name,
    brand_name: values.brand_name,
    company_id: values.company_id,
    category_id: values.category_id,
    subcategory_id: values.subcategory_id,
    strength: values.strength,
    dosage_form: values.dosage_form,
    unit: values.unit,
    pack_size: values.pack_size,
    barcode: values.barcode,
    sku: values.sku,
    mrp: values.mrp,
    minimum_stock: values.minimum_stock,
    reorder_level: values.reorder_level,
    tax_rate: values.tax_rate,
    description: values.description,
    prescription_required: values.prescription_required,
    is_active: values.is_active,
  };
  if (includeSalePrice) payload.default_sale_price = values.default_sale_price;
  if (includePurchasePrice) payload.default_purchase_price = values.default_purchase_price;
  return payload;
}

/** Numbers from PostgREST are display-only; this keeps them as plain strings. */
export function amountString(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === "number" ? String(value) : value;
}
