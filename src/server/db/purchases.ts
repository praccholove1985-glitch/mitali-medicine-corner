import "server-only";
import { createClient } from "@/lib/supabase/server";
import { failureFrom, type QuoteFailure } from "@/server/db/pos";
import { mapError } from "@/server/errors";
import { DataError } from "@/server/db/medicines";

async function client() {
  const supabase = await createClient();
  if (!supabase) throw new DataError("The database connection is not configured.");
  return supabase;
}

function raise(error: unknown, context: string): never {
  const mapped = mapError(error, context);
  throw new DataError(mapped.message, mapped.reference);
}

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

export type PurchaseMedicine = {
  id: string;
  name: string;
  genericName: string | null;
  companyName: string | null;
  strength: string | null;
  dosageForm: string | null;
  unit: string;
  defaultSalePrice: string | null;
  mrp: string | null;
};

/** Medicine lookup for the purchase form. No cost is returned: the user types the invoice price. */
export async function searchPurchaseMedicines(branchId: string, query: string): Promise<PurchaseMedicine[]> {
  const supabase = await client();
  const { data, error } = await supabase.rpc("search_medicines", {
    p_branch: branchId,
    p_query: query,
    p_limit: 15,
    p_offset: 0,
    p_include_inactive: false,
  });
  if (error) raise(error, "purchases.medicines");
  return ((data ?? []) as Row[]).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    genericName: str(r.generic_name),
    companyName: str(r.company_name),
    strength: str(r.strength),
    dosageForm: str(r.dosage_form),
    unit: String(r.unit ?? "pcs"),
    defaultSalePrice: str(r.default_sale_price),
    mrp: str(r.mrp),
  }));
}

export type PurchaseQuoteLine = {
  lineNo: number;
  gross: string;
  discount: string;
  taxAmount: string;
  lineTotal: string;
  unitCost: string;
  topsUpBatch: boolean;
  daysToExpiry: number | null;
};

export type PurchaseQuote = {
  lines: PurchaseQuoteLine[];
  totals: { subtotal: string; discountTotal: string; taxTotal: string; grandTotal: string };
};

/** Prices the purchase on the server. Nothing is written. */
export async function quotePurchase(
  branchId: string,
  supplierId: string,
  items: Array<Record<string, unknown>>,
): Promise<{ ok: true; quote: PurchaseQuote } | { ok: false; failure: QuoteFailure }> {
  const supabase = await client();
  const { data, error } = await supabase.rpc("quote_purchase", { p_branch: branchId, p_supplier: supplierId, p_items: items });
  if (error) return { ok: false, failure: failureFrom(error, "purchases.quote") };
  const r = data as { lines: Row[]; totals: Record<string, string | undefined> };
  return {
    ok: true,
    quote: {
      lines: r.lines.map((l) => ({
        lineNo: Number(l.line_no),
        gross: String(l.gross),
        discount: String(l.discount),
        taxAmount: String(l.tax_amount),
        lineTotal: String(l.line_total),
        unitCost: String(l.unit_cost),
        topsUpBatch: l.tops_up_batch === true,
        daysToExpiry: l.days_to_expiry === null || l.days_to_expiry === undefined ? null : Number(l.days_to_expiry),
      })),
      totals: {
        subtotal: String(r.totals.subtotal),
        discountTotal: String(r.totals.discount_total),
        taxTotal: String(r.totals.tax_total),
        grandTotal: String(r.totals.grand_total),
      },
    },
  };
}

export type PurchaseListRow = {
  id: string;
  purchaseNo: string;
  purchaseSeq: number;
  supplierId: string;
  supplierName: string;
  supplierInvoiceNo: string;
  invoiceDate: string;
  createdAt: string;
  itemCount: number;
  grandTotal: string;
  paidTotal: string;
  dueTotal: string;
};

export async function listPurchases(
  branchId: string,
  opts: { supplierId?: string | null; query?: string; from?: string | null; to?: string | null; beforeSeq?: number | null; limit?: number },
): Promise<{ items: PurchaseListRow[]; hasMore: boolean }> {
  const limit = Math.min(opts.limit ?? 25, 100);
  const supabase = await client();
  const { data, error } = await supabase.rpc("list_purchases", {
    p_branch: branchId,
    p_supplier: opts.supplierId ?? null,
    p_query: opts.query ?? "",
    p_from: opts.from ?? null,
    p_to: opts.to ?? null,
    p_before_seq: opts.beforeSeq ?? null,
    p_limit: limit + 1,
  });
  if (error) raise(error, "purchases.list");
  const rows = (data ?? []) as Row[];
  return {
    hasMore: rows.length > limit,
    items: rows.slice(0, limit).map((r) => ({
      id: String(r.purchase_id),
      purchaseNo: String(r.purchase_no),
      purchaseSeq: Number(r.purchase_seq),
      supplierId: String(r.supplier_id),
      supplierName: String(r.supplier_name),
      supplierInvoiceNo: String(r.supplier_invoice_no),
      invoiceDate: String(r.invoice_date),
      createdAt: String(r.created_at),
      itemCount: Number(r.item_count ?? 0),
      grandTotal: String(r.grand_total),
      paidTotal: String(r.paid_total),
      dueTotal: String(r.due_total),
    })),
  };
}

export type PurchaseDetail = {
  id: string;
  purchaseNo: string;
  createdAt: string;
  supplier: { id: string; name: string; phone: string | null } | null;
  supplierInvoiceNo: string;
  invoiceDate: string;
  notes: string | null;
  recordedBy: string | null;
  totals: { subtotal: string; discountTotal: string; taxTotal: string; grandTotal: string; paidTotal: string; dueTotal: string };
  items: Array<{
    lineNo: number;
    medicineId: string;
    name: string;
    strength: string | null;
    unit: string;
    batchId: string;
    batchNumber: string;
    expiryDate: string;
    quantity: number;
    freeQuantity: number;
    unitPrice: string;
    gross: string;
    discount: string;
    taxRate: string;
    taxAmount: string;
    lineTotal: string;
    unitCost: string;
    newBatch: boolean;
  }>;
  payments: Array<{ method: string; amount: string; reference: string | null }>;
};

export async function getPurchase(purchaseId: string): Promise<PurchaseDetail | null> {
  const supabase = await client();
  const { data, error } = await supabase.rpc("get_purchase", { p_purchase: purchaseId });
  if (error) raise(error, "purchases.get");
  if (!data) return null;
  const r = data as Row;
  const t = (r.totals ?? {}) as Record<string, string>;
  const supplier = r.supplier as Row | null;
  return {
    id: String(r.id),
    purchaseNo: String(r.purchase_no),
    createdAt: String(r.created_at),
    supplier: supplier ? { id: String(supplier.id), name: String(supplier.name), phone: str(supplier.phone) } : null,
    supplierInvoiceNo: String(r.supplier_invoice_no),
    invoiceDate: String(r.invoice_date),
    notes: str(r.notes),
    recordedBy: str(r.recorded_by),
    totals: {
      subtotal: String(t.subtotal),
      discountTotal: String(t.discount_total),
      taxTotal: String(t.tax_total),
      grandTotal: String(t.grand_total),
      paidTotal: String(t.paid_total),
      dueTotal: String(t.due_total),
    },
    items: ((r.items ?? []) as Row[]).map((i) => ({
      lineNo: Number(i.line_no),
      medicineId: String(i.medicine_id),
      name: String(i.name),
      strength: str(i.strength),
      unit: String(i.unit),
      batchId: String(i.batch_id),
      batchNumber: String(i.batch_number),
      expiryDate: String(i.expiry_date),
      quantity: Number(i.quantity),
      freeQuantity: Number(i.free_quantity),
      unitPrice: String(i.unit_price),
      gross: String(i.gross),
      discount: String(i.discount),
      taxRate: String(i.tax_rate),
      taxAmount: String(i.tax_amount),
      lineTotal: String(i.line_total),
      unitCost: String(i.unit_cost),
      newBatch: i.new_batch === true,
    })),
    payments: ((r.payments ?? []) as Row[]).map((p) => ({ method: String(p.method), amount: String(p.amount), reference: str(p.reference) })),
  };
}
