"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { buildMedicinePayload } from "@/lib/medicine-payload";
import {
  batchFormSchema,
  batchPriceSchema,
  catalogueNameSchema,
  firstErrorPerField,
  medicineFormSchema,
} from "@/lib/validation/medicine";
import { mapError } from "@/server/errors";
import { requireSession } from "@/server/session";

export type FormState = {
  ok?: boolean;
  /** A problem with the request as a whole (safe to show). */
  error?: string;
  /** Support reference for unexpected failures. */
  reference?: string;
  fieldErrors?: Record<string, string>;
  /** Echo of what the user typed so a failed submit does not clear the form. */
  values?: Record<string, string>;
};

function toValues(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");
const checked = (formData: FormData, key: string) => formData.get(key) === "on";

/**
 * Postgres names the violated unique index in its message. We read it only to
 * point at the right field; the text itself is never shown.
 */
function uniqueViolationField(error: { message?: string } | null): { field: string; message: string } | null {
  const message = error?.message ?? "";
  if (message.includes("medicines_barcode_key")) {
    return { field: "barcode", message: "Another medicine already uses this barcode." };
  }
  if (message.includes("medicines_sku_key")) {
    return { field: "sku", message: "Another medicine already uses this SKU." };
  }
  if (message.includes("medicine_batches_identity_key")) {
    return { field: "batch_number", message: "This batch (same number and expiry) already exists for this medicine." };
  }
  if (message.includes("companies_name_key") || message.includes("categories_name_key") || message.includes("subcategories_name_key")) {
    return { field: "name", message: "That name is already in use." };
  }
  return null;
}

function failure(error: unknown, context: string, values: Record<string, string>): FormState {
  const unique =
    typeof error === "object" && error !== null && (error as { code?: string }).code === "23505"
      ? uniqueViolationField(error as { message?: string })
      : null;
  if (unique) return { values, fieldErrors: { [unique.field]: unique.message } };

  const mapped = mapError(error, context);
  return { values, error: mapped.message, reference: mapped.reference };
}

export async function saveMedicineAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireSession();
  const values = toValues(formData);
  const id = text(formData, "id") || null;

  const parsed = medicineFormSchema.safeParse({
    ...values,
    prescription_required: checked(formData, "prescription_required"),
    is_active: id ? checked(formData, "is_active") : true,
  });
  if (!parsed.success) return { values, fieldErrors: firstErrorPerField(parsed.error) };

  const supabase = await createClient();
  if (!supabase) redirect("/setup");

  const payload = buildMedicinePayload(parsed.data, {
    includeSalePrice: text(formData, "has_sale_price_field") === "1",
    includePurchasePrice: text(formData, "has_purchase_price_field") === "1",
  });

  const { data, error } = await supabase.rpc("save_medicine", { p_id: id, p: payload });
  if (error) return failure(error, "medicine.save", values);

  const savedId = String(data);
  revalidatePath("/medicines");
  redirect(`/medicines/${savedId}?saved=1`);
}

export async function createBatchAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireSession();
  const values = toValues(formData);

  const parsed = batchFormSchema.safeParse(values);
  if (!parsed.success) return { values, fieldErrors: firstErrorPerField(parsed.error) };

  const supabase = await createClient();
  if (!supabase) redirect("/setup");

  const { error } = await supabase.rpc("create_batch", {
    p: {
      branch_id: session.branch.id,
      medicine_id: parsed.data.medicine_id,
      batch_number: parsed.data.batch_number,
      expiry_date: parsed.data.expiry_date,
      purchase_price: parsed.data.purchase_price,
      sale_price: parsed.data.sale_price,
      mrp: parsed.data.mrp,
      quantity: Number(parsed.data.quantity),
    },
  });
  if (error) {
    // An expiry problem belongs on the expiry field.
    if (error.code === "PH030") {
      return { values, fieldErrors: { expiry_date: mapError(error, "batch.create").message } };
    }
    return failure(error, "batch.create", values);
  }

  revalidatePath(`/medicines/${parsed.data.medicine_id}`);
  revalidatePath("/medicines");
  return { ok: true };
}

export async function updateBatchPricesAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireSession();
  const values = toValues(formData);

  const parsed = batchPriceSchema.safeParse(values);
  if (!parsed.success) return { values, fieldErrors: firstErrorPerField(parsed.error) };

  const supabase = await createClient();
  if (!supabase) redirect("/setup");

  const { error } = await supabase.rpc("update_batch_prices", {
    p_batch: parsed.data.batch_id,
    p_sale_price: parsed.data.sale_price,
    p_mrp: parsed.data.mrp,
  });
  if (error) return failure(error, "batch.prices", values);

  revalidatePath(`/medicines/${text(formData, "medicine_id")}`);
  return { ok: true };
}

export async function saveCatalogueAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireSession();
  const values = toValues(formData);
  const kind = text(formData, "kind");

  const parsed = catalogueNameSchema.safeParse({
    id: values.id || undefined,
    category_id: values.category_id || undefined,
    name: values.name ?? "",
    is_active: checked(formData, "is_active"),
  });
  if (!parsed.success) return { values, fieldErrors: firstErrorPerField(parsed.error) };

  const supabase = await createClient();
  if (!supabase) redirect("/setup");

  let result;
  if (kind === "company") {
    result = await supabase.rpc("save_company", {
      p_id: parsed.data.id ?? null,
      p_name: parsed.data.name,
      p_is_active: parsed.data.is_active,
    });
  } else if (kind === "category") {
    result = await supabase.rpc("save_category", {
      p_id: parsed.data.id ?? null,
      p_name: parsed.data.name,
      p_is_active: parsed.data.is_active,
    });
  } else if (kind === "subcategory") {
    if (!parsed.data.category_id) return { values, error: "Choose the category for this subcategory." };
    result = await supabase.rpc("save_subcategory", {
      p_id: parsed.data.id ?? null,
      p_category_id: parsed.data.category_id,
      p_name: parsed.data.name,
      p_is_active: parsed.data.is_active,
    });
  } else {
    return { values, error: "Something went wrong. Reload the page and try again." };
  }

  if (result.error) return failure(result.error, `catalogue.${kind}`, values);

  revalidatePath("/medicines/catalogue");
  revalidatePath("/medicines");
  return { ok: true };
}
