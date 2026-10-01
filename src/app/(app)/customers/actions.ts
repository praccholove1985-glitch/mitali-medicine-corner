"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { customerFormSchema, receivePaymentSchema } from "@/lib/validation/customer";
import { firstErrorPerField } from "@/lib/validation/medicine";
import { formatMoney } from "@/domain/money";
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

/** Create (no id) or edit a customer. The balance is not an input; only the ledger changes it. */
export async function saveCustomerFormAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireSession();
  const values = toValues(formData);

  const parsed = customerFormSchema.safeParse({ ...values, id: values.id || undefined });
  if (!parsed.success) return { values, fieldErrors: firstErrorPerField(parsed.error) };

  const supabase = await createClient();
  if (!supabase) redirect("/setup");

  const isEdit = Boolean(parsed.data.id);
  const { error } = await supabase.rpc("save_customer", {
    p: {
      ...(parsed.data.id ? { id: parsed.data.id } : {}),
      branch_id: session.branch.id,
      name: parsed.data.name,
      // On edit an empty field clears the value, so send null rather than leaving it out.
      phone: parsed.data.phone ?? null,
      address: parsed.data.address ?? null,
      credit_limit: parsed.data.credit_limit ?? null,
    },
  });
  if (error) {
    if (error.code === "23505") {
      return { values, fieldErrors: { phone: "Another customer already has this phone number." } };
    }
    return failure(error, isEdit ? "customer.edit" : "customer.create", values);
  }

  revalidatePath("/customers", "layout");
  return { ok: true };
}

/** Deactivating hides a customer from the till; their ledger stays and they can still pay. */
export async function setCustomerActiveAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireSession();
  const id = String(formData.get("id") ?? "");
  const active = formData.get("is_active") === "true";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "That customer could not be found." };

  const supabase = await createClient();
  if (!supabase) redirect("/setup");

  const { error } = await supabase.rpc("save_customer", {
    p: { id, branch_id: session.branch.id, is_active: active },
  });
  if (error) return failure(error, "customer.set_active", {});

  revalidatePath("/customers", "layout");
  return { ok: true };
}

export async function receivePaymentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireSession();
  const values = toValues(formData);

  const parsed = receivePaymentSchema.safeParse(values);
  if (!parsed.success) return { values, fieldErrors: firstErrorPerField(parsed.error) };

  const supabase = await createClient();
  if (!supabase) redirect("/setup");

  const { error } = await supabase.rpc("receive_customer_payment", {
    p: {
      branch_id: session.branch.id,
      customer_id: parsed.data.customer_id,
      client_request_id: parsed.data.client_request_id,
      method: parsed.data.method,
      amount: parsed.data.amount,
      reference: parsed.data.reference ?? null,
      note: parsed.data.note ?? null,
    },
  });
  if (error) {
    if (error.code === "PH058") {
      // The database says what is actually due; show that instead of the form's stale figure.
      let due: string | null = null;
      try {
        due = (JSON.parse(error.hint ?? "{}") as { due?: string }).due ?? null;
      } catch {
        due = null;
      }
      const owed = due === null ? null : formatMoney(due, { fractionDigits: 2 });
      return {
        values,
        fieldErrors: {
          amount: owed === null || due === "0.00" ? "This customer doesn't owe anything right now." : `This customer owes ${owed}. Enter that or less.`,
        },
      };
    }
    return failure(error, "customer.payment", values);
  }

  revalidatePath("/customers", "layout");
  return { ok: true };
}
