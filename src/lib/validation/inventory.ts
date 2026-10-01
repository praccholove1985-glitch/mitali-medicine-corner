import { z } from "zod";
import { uuidLike } from "@/lib/validation/common";
import { MANUAL_MOVEMENT_TYPES } from "@/lib/inventory-payload";


export const adjustStockSchema = z.object({
  batch_id: uuidLike,
  medicine_id: uuidLike,
  client_request_id: uuidLike,
  movement_type: z.enum(MANUAL_MOVEMENT_TYPES, { message: "Choose what kind of change this is." }),
  direction: z.enum(["add", "remove"], { message: "Choose whether stock goes up or down." }),
  quantity: z
    .string()
    .trim()
    .regex(/^[1-9]\d{0,8}$/, "Enter how many units, as a whole number above 0."),
  reason: z
    .string()
    .trim()
    .min(1, "Say why. Every stock change needs a reason.")
    .max(300, "Keep the reason under 300 characters."),
});

export const writeOffSchema = z.object({
  batch_ids: z.array(uuidLike).min(1, "Choose at least one batch.").max(100, "Write off at most 100 batches at a time."),
  reason: z
    .string()
    .trim()
    .max(300, "Keep the reason under 300 characters.")
    .optional()
    .transform((value) => (value ? value : undefined)),
});
