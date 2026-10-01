import { z } from "zod";
import { amountToUnits, isValidAmount } from "@/domain/money";

/** Any 8-4-4-4-12 hex id. Zod's own uuid() rejects some ids Postgres will accept. */
const uuidLike = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Invalid id.");

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters.`)
    .optional()
    .transform((value) => (value === undefined || value === "" ? null : value));

/** Empty means "not set"; otherwise an exact decimal string. Never a JS number. */
const optionalAmount = (label: string) =>
  z
    .string()
    .trim()
    .optional()
    .superRefine((value, ctx) => {
      if (value && !isValidAmount(value)) {
        ctx.addIssue({ code: "custom", message: `Enter ${label} as an amount like 12.50 (up to 4 decimals).` });
      }
    })
    .transform((value) => (value ? value : null));

const wholeNumber = (label: string, fallback: number) =>
  z
    .string()
    .trim()
    .optional()
    .superRefine((value, ctx) => {
      if (value && !/^\d{1,9}$/.test(value)) {
        ctx.addIssue({ code: "custom", message: `${label} must be a whole number.` });
      }
    })
    .transform((value) => (value ? Number(value) : fallback));

const optionalId = z
  .string()
  .trim()
  .optional()
  .refine((value) => !value || /^[0-9a-f-]{36}$/i.test(value), "Choose a valid option.")
  .transform((value) => (value ? value : null));

export const medicineFormSchema = z
  .object({
    name: z.string().trim().min(1, "Enter the medicine name.").max(200, "Keep the name under 200 characters."),
    generic_name: optionalText(200),
    brand_name: optionalText(200),
    company_id: optionalId,
    category_id: optionalId,
    subcategory_id: optionalId,
    strength: optionalText(60),
    dosage_form: optionalText(60),
    unit: z.string().trim().min(1, "Enter a unit, e.g. pcs.").max(30),
    pack_size: wholeNumber("Pack size", 1),
    barcode: optionalText(64),
    sku: optionalText(64),
    default_purchase_price: optionalAmount("the purchase price"),
    default_sale_price: optionalAmount("the sale price"),
    mrp: optionalAmount("the MRP"),
    minimum_stock: wholeNumber("Minimum stock", 0),
    reorder_level: wholeNumber("Reorder level", 0),
    tax_rate: z
      .string()
      .trim()
      .optional()
      .superRefine((value, ctx) => {
        if (value && !/^\d{1,3}(\.\d{1,2})?$/.test(value)) {
          ctx.addIssue({ code: "custom", message: "Enter a tax rate like 5 or 7.5." });
        } else if (value && Number(value) > 100) {
          ctx.addIssue({ code: "custom", message: "Tax rate can't be more than 100." });
        }
      })
      .transform((value) => (value ? value : "0")),
    description: optionalText(2000),
    prescription_required: z.boolean(),
    is_active: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.pack_size < 1) {
      ctx.addIssue({ code: "custom", path: ["pack_size"], message: "Pack size must be at least 1." });
    }
    if (value.subcategory_id && !value.category_id) {
      ctx.addIssue({ code: "custom", path: ["subcategory_id"], message: "Choose a category first." });
    }
    const sale = value.default_sale_price ? amountToUnits(value.default_sale_price) : null;
    const mrp = value.mrp ? amountToUnits(value.mrp) : null;
    if (sale !== null && mrp !== null && sale > mrp) {
      ctx.addIssue({ code: "custom", path: ["default_sale_price"], message: "The sale price can't be higher than the MRP." });
    }
  });

export type MedicineFormValues = z.infer<typeof medicineFormSchema>;

export const batchFormSchema = z
  .object({
    medicine_id: uuidLike,
    batch_number: z.string().trim().min(1, "Enter the batch number.").max(64, "Keep this under 64 characters."),
    expiry_date: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the expiry date."),
    quantity: z
      .string()
      .trim()
      .regex(/^[1-9]\d{0,8}$/, "Enter how many units are on the shelf (a whole number above 0)."),
    purchase_price: z.string().trim().refine(isValidAmount, "Enter the cost per unit, e.g. 1.10."),
    sale_price: z.string().trim().refine(isValidAmount, "Enter the sale price per unit, e.g. 1.50."),
    mrp: z
      .string()
      .trim()
      .optional()
      .refine((v) => !v || isValidAmount(v), "Enter the MRP as an amount like 2.00.")
      .transform((v) => (v ? v : null)),
  })
  .superRefine((value, ctx) => {
    const sale = amountToUnits(value.sale_price);
    const mrp = value.mrp ? amountToUnits(value.mrp) : null;
    if (sale !== null && mrp !== null && sale > mrp) {
      ctx.addIssue({ code: "custom", path: ["sale_price"], message: "The sale price can't be higher than the MRP." });
    }
  });

export const batchPriceSchema = z
  .object({
    batch_id: uuidLike,
    sale_price: z.string().trim().refine(isValidAmount, "Enter the sale price per unit, e.g. 1.50."),
    mrp: z
      .string()
      .trim()
      .optional()
      .refine((v) => !v || isValidAmount(v), "Enter the MRP as an amount like 2.00.")
      .transform((v) => (v ? v : null)),
  })
  .superRefine((value, ctx) => {
    const sale = amountToUnits(value.sale_price);
    const mrp = value.mrp ? amountToUnits(value.mrp) : null;
    if (sale !== null && mrp !== null && sale > mrp) {
      ctx.addIssue({ code: "custom", path: ["sale_price"], message: "The sale price can't be higher than the MRP." });
    }
  });

export const catalogueNameSchema = z.object({
  id: uuidLike.optional(),
  category_id: uuidLike.optional(),
  name: z.string().trim().min(1, "Enter a name.").max(120, "Keep the name under 120 characters."),
  is_active: z.boolean(),
});

/** Flattens zod issues to the first message per field, for inline form errors. */
export function firstErrorPerField(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}
