"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { paySupplierSchema, supplierFormSchema } from "@/lib/validation/supplier";
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

/** Create (no id) or edit a supplier. The balance is not an input; only the ledger changes it. */
export async function saveSupplierFormAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireSession();
  const values = toValues(formData);

  const parsed = supplierFormSchema.safeParse({ ...values, id: values.id || undefined });
  if (!parsed.success) return { values, fieldErrors: firstErrorPerField(parsed.error) };

  const supabase = await createClient();
  if (!supabase) redirect("/setup");

  const isEdit = Boolean(parsed.data.id);
  const { error } = await supabase.rpc("save_supplier", {
    p: {
      ...(parsed.data.id ? { id: parsed.data.id } : {}),
      branch_id: session.branch.id,
      name: parsed.data.name,
      // On edit an empty field clears the value, so send null rather than leaving it out.
      contact_person: parsed.data.contact_person ?? null,
      phone: parsed.data.phone ?? null,
      address: parsed.data.address ?? null,
    },
  });
  if (error) {
    if (error.code === "23505") {
      return { values, fieldErrors: { name: "A supplier with this name already exists." } };
    }
    return failure(error, isEdit ? "supplier.edit" : "supplier.create", values);
  }

  revalidatePath("/suppliers", "layout");
  return { ok: true };
}

/** Deactivating hides a supplier from new purchases; the ledger stays and they can still be paid. */
export async function setSupplierActiveAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireSession();
  const id = String(formData.get("id") ?? "");
  const active = formData.get("is_active") === "true";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "That supplier could not be found." };

  const supabase = await createClient();
  if (!supabase) redirect("/setup");

  const { error } = await supabase.rpc("save_supplier", {
    p: { id, branch_id: session.branch.id, is_active: active },
  });
  if (error) return failure(error, "supplier.set_active", {});

  revalidatePath("/suppliers", "layout");
  return { ok: true };
}

export async function paySupplierAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireSession();
  const values = toValues(formData);

  const parsed = paySupplierSchema.safeParse(values);
  if (!parsed.success) return { values, fieldErrors: firstErrorPerField(parsed.error) };

  const supabase = await createClient();
  if (!supabase) redirect("/setup");

  const { error } = await supabase.rpc("pay_supplier", {
    p: {
      branch_id: session.branch.id,
      supplier_id: parsed.data.supplier_id,
      client_request_id: parsed.data.client_request_id,
      method: parsed.data.method,
      amount: parsed.data.amount,
      reference: parsed.data.reference ?? null,
      note: parsed.data.note ?? null,
    },
  });
  if (error) {
    if (error.code === "PH060") {
      // The database says what is actually owed; show that instead of the form's stale figure.
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
          amount: owed === null || due === "0.00" ? "You don't owe this supplier anything right now." : `You owe this supplier ${owed}. Enter that or less.`,
        },
      };
    }
    return failure(error, "supplier.payment", values);
  }

  revalidatePath("/suppliers", "layout");
  revalidatePath("/");
  return { ok: true };
}
