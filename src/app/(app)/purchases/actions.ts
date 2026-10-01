"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createPurchaseSchema } from "@/lib/validation/purchase";
import { formatMoney } from "@/domain/money";
import { failureFrom } from "@/server/db/pos";
import { requireSession } from "@/server/session";

export type PurchaseFailure = {
  ok: false;
  code: string;
  message: string;
  reference?: string;
  /** Which part of the form the problem belongs to, when the database can tell. */
  field?: "supplierInvoiceNo" | "payments" | "items" | "invoiceDate";
  /** 1-based line number when the problem is on one line. */
  line?: number;
};
export type CreatePurchaseResult = { ok: true; purchaseId: string; purchaseNo: string } | PurchaseFailure;

function lineOf(message: string | undefined): number | undefined {
  const m = /^line (\d+):/i.exec(message ?? "");
  return m ? Number(m[1]) : undefined;
}

/**
 * Records a purchase in one database call. The browser sends what was typed (quantities, prices as
 * text); every total, cost and balance is worked out by the database.
 */
export async function createPurchaseAction(input: unknown): Promise<CreatePurchaseResult> {
  const session = await requireSession();
  const parsed = createPurchaseSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "INVALID", message: parsed.error.issues[0]?.message ?? "Check the purchase and try again." };
  }
  const p = parsed.data;

  const supabase = await createClient();
  if (!supabase) redirect("/setup");

  const { data, error } = await supabase.rpc("create_purchase", {
    p: {
      branch_id: session.branch.id,
      client_request_id: p.clientRequestId,
      supplier_id: p.supplierId,
      supplier_invoice_no: p.supplierInvoiceNo,
      invoice_date: p.invoiceDate,
      notes: p.notes || null,
      items: p.items,
      payments: p.payments.map((x) => ({ method: x.method, amount: x.amount, reference: x.reference || null })),
    },
  });

  if (error) {
    const f = failureFrom(error, "purchase.create");
    const base: PurchaseFailure = { ok: false, code: f.code, message: f.message, reference: f.reference };
    switch (error.code) {
      case "PH059": {
        const no = typeof f.hint?.purchase_no === "string" ? f.hint.purchase_no : null;
        return { ...base, field: "supplierInvoiceNo", message: no ? `That supplier invoice was already entered as ${no}.` : f.message };
      }
      case "PH061": {
        const total = typeof f.hint?.grand_total === "string" ? formatMoney(f.hint.grand_total, { fractionDigits: 2 }) : null;
        return { ...base, field: "payments", message: total ? `The payments are more than the purchase total of ${total}.` : f.message };
      }
      case "PH062":
        return { ...base, field: "items" };
      case "PH030":
      case "PH031":
      case "PH050":
      case "PH063":
      case "P0002":
      case "22023":
        return { ...base, field: lineOf(error.message) ? "items" : error.code === "22023" ? undefined : "items", line: lineOf(error.message) };
      default:
        return base;
    }
  }

  const result = data as { purchase_id?: string; purchase_no?: string } | null;
  if (!result?.purchase_id) {
    return { ok: false, code: "UNKNOWN", message: "The purchase was recorded but could not be shown. Check the purchases list." };
  }

  revalidatePath("/purchases", "layout");
  revalidatePath("/suppliers", "layout");
  revalidatePath("/inventory", "layout");
  revalidatePath("/");
  return { ok: true, purchaseId: result.purchase_id, purchaseNo: String(result.purchase_no) };
}
