"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { completeSaleSchema, customerSchema, draftSchema } from "@/lib/validation/sale";
import { failureFrom, type PosCustomer } from "@/server/db/pos";
import { mapError } from "@/server/errors";
import { requireSession } from "@/server/session";


export type ActionFailure = {
  ok: false;
  code: string;
  message: string;
  reference?: string;
  /** 1-based cart line the database blamed, when it named one. */
  line?: number;
  /** Extra numbers the message can use (totals, limits). Ids and counts only. */
  hint?: Record<string, unknown>;
};

export type CompleteSaleResult = { ok: true; saleId: string; invoiceNo: string } | ActionFailure;

function asFailure(error: unknown, context: string): ActionFailure {
  const f = failureFrom(error, context);
  const line = typeof f.hint?.line === "number" ? f.hint.line : undefined;
  return { ok: false, code: f.code, message: f.message, reference: f.reference, line, hint: f.hint ?? undefined };
}

/**
 * Completes a sale in ONE database call. The browser sends only what the cashier chose
 * (medicines, quantities, discounts, batches, payment amounts); prices, totals, stock
 * and the ledger are all decided inside complete_sale in a single transaction.
 */
export async function completeSaleAction(input: unknown): Promise<CompleteSaleResult> {
  const session = await requireSession();
  const parsed = completeSaleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "INVALID", message: parsed.error.issues[0]?.message ?? "Check the sale and try again." };
  }
  const sale = parsed.data;

  const supabase = await createClient();
  if (!supabase) redirect("/setup");

  const { data, error } = await supabase.rpc("complete_sale", {
    p: {
      branch_id: session.branch.id,
      client_request_id: sale.clientRequestId,
      customer_id: sale.customerId,
      notes: sale.notes || null,
      items: sale.items,
      payments: sale.payments.map((p) => ({ method: p.method, amount: p.amount, reference: p.reference || null })),
    },
  });
  if (error) return asFailure(error, "sale.complete");

  const invoice = data as { id?: string; invoice_no?: string } | null;
  if (!invoice?.id) return { ok: false, code: "UNKNOWN", message: "The sale was recorded but the invoice could not be shown. Check the sales history." };

  revalidatePath("/pos/history");
  revalidatePath("/inventory", "layout");
  revalidatePath("/");
  return { ok: true, saleId: invoice.id, invoiceNo: String(invoice.invoice_no) };
}

export type DraftResult = { ok: true; id: string } | ActionFailure;

export async function saveDraftAction(input: unknown): Promise<DraftResult> {
  const session = await requireSession();
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "INVALID", message: parsed.error.issues[0]?.message ?? "Check the cart and try again." };

  const supabase = await createClient();
  if (!supabase) redirect("/setup");

  const { data, error } = await supabase.rpc("save_sale_draft", {
    p: {
      id: parsed.data.id,
      branch_id: session.branch.id,
      name: parsed.data.name || null,
      customer_id: parsed.data.customerId,
      items: parsed.data.items,
    },
  });
  if (error) return asFailure(error, "draft.save");
  return { ok: true, id: String(data) };
}

export async function deleteDraftAction(id: string): Promise<{ ok: true } | ActionFailure> {
  await requireSession();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, code: "INVALID", message: "That saved cart wasn't found." };

  const supabase = await createClient();
  if (!supabase) redirect("/setup");
  const { error } = await supabase.rpc("delete_sale_draft", { p_draft: id });
  if (error) return asFailure(error, "draft.delete");
  return { ok: true };
}

export type CustomerResult = { ok: true; customer: PosCustomer } | ActionFailure;

/** Quick-add from the till: a name and optionally a phone number. */
export async function saveCustomerAction(input: unknown): Promise<CustomerResult> {
  const session = await requireSession();
  const parsed = customerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "INVALID", message: parsed.error.issues[0]?.message ?? "Check the details and try again." };

  const supabase = await createClient();
  if (!supabase) redirect("/setup");

  const { data, error } = await supabase.rpc("save_customer", {
    p: {
      branch_id: session.branch.id,
      name: parsed.data.name,
      phone: parsed.data.phone ?? null,
      address: parsed.data.address ?? null,
    },
  });
  if (error) {
    if (error.code === "23505") return { ok: false, code: "CONFLICT", message: "A customer with that phone number already exists. Search for them instead." };
    const mapped = mapError(error, "customer.save");
    return { ok: false, code: mapped.code, message: mapped.message, reference: mapped.reference };
  }
  return {
    ok: true,
    customer: {
      id: String(data),
      name: parsed.data.name,
      phone: parsed.data.phone ?? null,
      address: parsed.data.address ?? null,
      creditLimit: null,
      balance: "0",
    },
  };
}
