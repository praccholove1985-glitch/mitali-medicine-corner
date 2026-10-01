"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signedDelta } from "@/lib/inventory-payload";
import { adjustStockSchema, writeOffSchema } from "@/lib/validation/inventory";
import { firstErrorPerField } from "@/lib/validation/medicine";
import { mapError } from "@/server/errors";
import { requireSession } from "@/server/session";
import type { FormState } from "@/app/(app)/medicines/actions";

function toValues(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

function failure(error: unknown, context: string, values: Record<string, string>): FormState {
  const mapped = mapError(error, context);
  return { values, error: mapped.message, reference: mapped.reference };
}

export async function adjustStockAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireSession();
  const values = toValues(formData);

  const parsed = adjustStockSchema.safeParse(values);
  if (!parsed.success) return { values, fieldErrors: firstErrorPerField(parsed.error) };

  const supabase = await createClient();
  if (!supabase) redirect("/setup");

  const { error } = await supabase.rpc("adjust_stock", {
    p: {
      batch_id: parsed.data.batch_id,
      movement_type: parsed.data.movement_type,
      quantity_delta: signedDelta(parsed.data.movement_type, parsed.data.direction, Number(parsed.data.quantity)),
      reason: parsed.data.reason,
      client_request_id: parsed.data.client_request_id,
    },
  });
  if (error) {
    // Quantity and type problems belong next to those fields.
    if (error.code === "PH041") return { values, fieldErrors: { quantity: mapError(error, "stock.adjust").message } };
    if (error.code === "PH042") return { values, fieldErrors: { movement_type: mapError(error, "stock.adjust").message } };
    return failure(error, "stock.adjust", values);
  }

  revalidatePath(`/medicines/${parsed.data.medicine_id}`);
  revalidatePath("/inventory", "layout");
  return { ok: true };
}

export async function writeOffExpiredAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireSession();
  const values = toValues(formData);

  const parsed = writeOffSchema.safeParse({
    batch_ids: formData.getAll("batch_id").map(String),
    reason: values.reason,
  });
  if (!parsed.success) return { values, error: Object.values(firstErrorPerField(parsed.error))[0] ?? "Check the details and try again." };

  const supabase = await createClient();
  if (!supabase) redirect("/setup");

  const { error } = await supabase.rpc("write_off_expired", {
    p_branch: session.branch.id,
    p_batch_ids: parsed.data.batch_ids,
    ...(parsed.data.reason ? { p_reason: parsed.data.reason } : {}),
  });
  if (error) return failure(error, "stock.writeoff", values);

  revalidatePath("/inventory", "layout");
  return { ok: true };
}
