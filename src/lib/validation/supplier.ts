import { z } from "zod";
import { uuidLike } from "@/lib/validation/common";
import { parsePaisa } from "@/domain/money";
import { MONEY_PAYMENT_METHODS } from "@/lib/validation/sale";

const emptyToUndefined = (v: string | undefined) => (v ? v : undefined);

/** Create or edit a supplier. The balance is never an input: only the ledger changes it. */
export const supplierFormSchema = z.object({
  id: uuidLike.optional(),
  name: z.string().trim().min(1, "Enter the supplier's name.").max(120, "Keep the name under 120 characters."),
  contact_person: z.string().trim().max(120, "Keep the contact name under 120 characters.").optional().transform(emptyToUndefined),
  phone: z
    .string()
    .trim()
    .max(32, "Keep the phone number under 32 characters.")
    .regex(/^[0-9+\-() ]*$/, "Use digits only (spaces, +, - and brackets are fine).")
    .optional()
    .transform(emptyToUndefined),
  address: z.string().trim().max(300, "Keep the address under 300 characters.").optional().transform(emptyToUndefined),
});

export const paySupplierSchema = z.object({
  supplier_id: uuidLike,
  client_request_id: uuidLike,
  method: z.enum(MONEY_PAYMENT_METHODS, { message: "Choose how you paid." }),
  amount: z.string().trim().refine((v) => {
    const paisa = parsePaisa(v);
    return paisa !== null && paisa > BigInt(0);
  }, "Enter an amount above 0 with at most 2 decimals."),
  reference: z.string().trim().max(64, "Keep the reference under 64 characters.").optional().transform(emptyToUndefined),
  note: z.string().trim().max(300, "Keep the note under 300 characters.").optional().transform(emptyToUndefined),
});

export const SUPPLIER_FILTERS = ["all", "due", "inactive"] as const;
export type SupplierFilter = (typeof SUPPLIER_FILTERS)[number];
