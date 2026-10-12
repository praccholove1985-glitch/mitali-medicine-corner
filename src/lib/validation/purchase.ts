import { z } from "zod";
import { uuidLike } from "@/lib/validation/common";
import { parsePaisa } from "@/domain/money";
import { MONEY_PAYMENT_METHODS } from "@/lib/validation/sale";

/** A non-negative decimal with at most 4 places, as typed. Never parsed to a float. */
const price4 = z.string().trim().regex(/^\d{1,10}(\.\d{1,4})?$/, "Use a number with at most 4 decimals.");
const percent = z.string().trim().regex(/^\d{1,3}(\.\d{1,2})?$/, "Use a number with at most 2 decimals.");
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date.")
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Enter a real date.");

export const purchaseLineSchema = z
  .object({
    medicine_id: uuidLike,
    batch_number: z.string().trim().min(1, "Enter the batch number.").max(64, "Keep the batch number under 64 characters."),
    expiry_date: isoDate,
    quantity: z.number().int("Use whole units.").min(0).max(1_000_000),
    free_quantity: z.number().int("Use whole units.").min(0).max(1_000_000),
    unit_price: price4,
    discount_type: z.enum(["NONE", "AMOUNT", "PERCENT"]).optional(),
    discount_value: price4.optional(),
    tax_rate: percent.optional(),
    sale_price: price4.optional(),
    mrp: price4.optional(),
  })
  .refine((l) => l.quantity + l.free_quantity > 0, { message: "Enter how many units arrived (free units count).", path: ["quantity"] });

export type PurchaseLineInput = z.infer<typeof purchaseLineSchema>;

export const purchaseItemsSchema = z.array(purchaseLineSchema).min(1, "Add at least one line.").max(200, "A purchase can have at most 200 lines.");

export const purchasePaymentSchema = z.object({
  method: z.enum(MONEY_PAYMENT_METHODS),
  amount: z.string().trim().refine((v) => {
    const paisa = parsePaisa(v);
    return paisa !== null && paisa > BigInt(0);
  }, "Enter an amount above 0 with at most 2 decimals."),
  reference: z.string().trim().max(64, "Keep the reference under 64 characters.").optional(),
});

export const createPurchaseSchema = z.object({
  clientRequestId: uuidLike,
  supplierId: uuidLike,
  supplierInvoiceNo: z.string().trim().min(1, "Enter the supplier's invoice number.").max(64, "Keep the invoice number under 64 characters."),
  invoiceDate: isoDate,
  notes: z.string().trim().max(500, "Keep the note under 500 characters.").optional(),
  items: purchaseItemsSchema,
  payments: z.array(purchasePaymentSchema).max(12),
});

export type CreatePurchaseInput = z.infer<typeof createPurchaseSchema>;

export const quotePurchaseSchema = z.object({
  supplierId: uuidLike,
  items: purchaseItemsSchema,
});

/** Expiry within this many days is flagged, not blocked (the database blocks only expired stock). */
export const EXPIRY_NEAR_DAYS = 90;
