import { z } from "zod";
import { uuidLike } from "@/lib/validation/common";
import { parsePaisa } from "@/domain/money";

export const MONEY_PAYMENT_METHODS = ["CASH", "BKASH", "NAGAD", "ROCKET", "CARD", "BANK"] as const;
export const PAYMENT_METHODS = [...MONEY_PAYMENT_METHODS, "CREDIT"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  CASH: "Cash",
  BKASH: "bKash",
  NAGAD: "Nagad",
  ROCKET: "Rocket",
  CARD: "Card",
  BANK: "Bank",
  CREDIT: "Credit (pay later)",
};

/** Methods that carry a transaction id worth recording. */
export const METHODS_WITH_REFERENCE: readonly PaymentMethod[] = ["BKASH", "NAGAD", "ROCKET", "CARD", "BANK"];

export const cartItemSchema = z.object({
  medicine_id: uuidLike,
  quantity: z.number().int().min(1).max(100000),
  discount_type: z.enum(["AMOUNT", "PERCENT"]).optional(),
  discount_value: z.string().trim().max(12).optional(),
  batch_id: uuidLike.optional(),
});

export const cartItemsSchema = z.array(cartItemSchema).min(1, "The cart is empty.").max(100, "A sale can have at most 100 lines.");

export const paymentSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  amount: z
    .string()
    .trim()
    .refine((v) => {
      const paisa = parsePaisa(v);
      return paisa !== null && paisa > BigInt(0);
    }, "Enter an amount above 0 with at most 2 decimals."),
  reference: z.string().trim().max(64, "Keep the reference under 64 characters.").optional(),
});

export const completeSaleSchema = z.object({
  clientRequestId: uuidLike,
  customerId: uuidLike.nullable(),
  notes: z.string().trim().max(500).optional(),
  items: cartItemsSchema,
  payments: z.array(paymentSchema).max(12),
});

export type CompleteSaleInput = z.infer<typeof completeSaleSchema>;

export const draftSchema = z.object({
  id: uuidLike.optional(),
  name: z.string().trim().max(80, "Keep the name under 80 characters.").optional(),
  customerId: uuidLike.nullable(),
  items: cartItemsSchema,
});

export const customerSchema = z.object({
  name: z.string().trim().min(1, "Enter the customer's name.").max(120, "Keep the name under 120 characters."),
  phone: z
    .string()
    .trim()
    .max(32, "Keep the phone number under 32 characters.")
    .optional()
    .transform((v) => (v ? v : undefined)),
  address: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => (v ? v : undefined)),
});
