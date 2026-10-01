import { z } from "zod";
import { uuidLike } from "@/lib/validation/common";
import { parsePaisa } from "@/domain/money";
import { MONEY_PAYMENT_METHODS } from "@/lib/validation/sale";

const emptyToUndefined = (v: string | undefined) => (v ? v : undefined);

/** Create or edit a customer. The balance is never an input: only the ledger changes it. */
export const customerFormSchema = z.object({
  id: uuidLike.optional(),
  name: z.string().trim().min(1, "Enter the customer's name.").max(120, "Keep the name under 120 characters."),
  phone: z
    .string()
    .trim()
    .max(32, "Keep the phone number under 32 characters.")
    .regex(/^[0-9+\-() ]*$/, "Use digits only (spaces, +, - and brackets are fine).")
    .optional()
    .transform(emptyToUndefined),
  address: z.string().trim().max(300, "Keep the address under 300 characters.").optional().transform(emptyToUndefined),
  credit_limit: z
    .string()
    .trim()
    .refine((v) => v === "" || parsePaisa(v) !== null, "Enter an amount with at most 2 decimals, or leave it empty for no limit.")
    .optional()
    .transform(emptyToUndefined),
});

export const receivePaymentSchema = z.object({
  customer_id: uuidLike,
  client_request_id: uuidLike,
  method: z.enum(MONEY_PAYMENT_METHODS, { message: "Choose how the customer paid." }),
  amount: z.string().trim().refine((v) => {
    const paisa = parsePaisa(v);
    return paisa !== null && paisa > BigInt(0);
  }, "Enter an amount above 0 with at most 2 decimals."),
  reference: z.string().trim().max(64, "Keep the reference under 64 characters.").optional().transform(emptyToUndefined),
  note: z.string().trim().max(300, "Keep the note under 300 characters.").optional().transform(emptyToUndefined),
});

export const CUSTOMER_FILTERS = ["all", "due", "over_limit", "inactive"] as const;
export type CustomerFilter = (typeof CUSTOMER_FILTERS)[number];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    // Round-trip: "2026-02-31" parses in some engines by rolling over to March.
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  });

/** Statement range from the URL. Falls back to the given defaults when missing or invalid. */
export function parseStatementRange(
  from: string | undefined,
  to: string | undefined,
  defaults: { from: string; to: string },
): { from: string; to: string } {
  const f = isoDate.safeParse(from);
  const t = isoDate.safeParse(to);
  if (!f.success || !t.success || f.data > t.data) return defaults;
  const days = (Date.parse(`${t.data}T00:00:00Z`) - Date.parse(`${f.data}T00:00:00Z`)) / 86_400_000;
  if (days > 3660) return defaults;
  return { from: f.data, to: t.data };
}
