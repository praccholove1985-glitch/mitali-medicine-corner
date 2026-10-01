import "server-only";
import { createClient } from "@/lib/supabase/server";
import { amountString } from "@/lib/medicine-payload";
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

export type PosMedicine = {
  id: string;
  name: string;
  genericName: string | null;
  strength: string | null;
  dosageForm: string | null;
  unit: string;
  companyName: string | null;
  barcode: string | null;
  sku: string | null;
  prescriptionRequired: boolean;
  salePrice: string | null;
  mrp: string | null;
  sellableQty: number;
  batchCount: number;
  nearestExpiry: string | null;
  exactMatch: boolean;
};

export async function posSearch(branchId: string, query: string, limit = 20): Promise<PosMedicine[]> {
  const supabase = await client();
  const { data, error } = await supabase.rpc("pos_search", { p_branch: branchId, p_query: query, p_limit: limit });
  if (error) raise(error, "pos.search");
  return ((data ?? []) as Row[]).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    genericName: str(r.generic_name),
    strength: str(r.strength),
    dosageForm: str(r.dosage_form),
    unit: String(r.unit),
    companyName: str(r.company_name),
    barcode: str(r.barcode),
    sku: str(r.sku),
    prescriptionRequired: Boolean(r.prescription_required),
    salePrice: amountString(r.sale_price as number | null),
    mrp: amountString(r.mrp as number | null),
    sellableQty: Number(r.sellable_qty ?? 0),
    batchCount: Number(r.batch_count ?? 0),
    nearestExpiry: str(r.nearest_expiry),
    exactMatch: Boolean(r.exact_match),
  }));
}

export type PosBatch = {
  id: string;
  batchNumber: string;
  expiryDate: string;
  daysToExpiry: number;
  quantity: number;
  salePrice: string;
  mrp: string | null;
};

export async function posBatches(branchId: string, medicineId: string): Promise<PosBatch[]> {
  const supabase = await client();
  const { data, error } = await supabase.rpc("pos_batches", { p_branch: branchId, p_medicine: medicineId });
  if (error) raise(error, "pos.batches");
  return ((data ?? []) as Row[]).map((r) => ({
    id: String(r.id),
    batchNumber: String(r.batch_number),
    expiryDate: String(r.expiry_date),
    daysToExpiry: Number(r.days_to_expiry),
    quantity: Number(r.quantity),
    salePrice: amountString(r.sale_price as number) ?? "0",
    mrp: amountString(r.mrp as number | null),
  }));
}

export type PosCustomer = {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  creditLimit: string | null;
  balance: string;
};

export async function searchCustomers(branchId: string, query: string, limit = 10): Promise<PosCustomer[]> {
  const supabase = await client();
  const { data, error } = await supabase.rpc("search_customers", { p_branch: branchId, p_query: query, p_limit: limit });
  if (error) raise(error, "pos.customers");
  return ((data ?? []) as Row[]).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    phone: str(r.phone),
    address: str(r.address),
    creditLimit: amountString(r.credit_limit as number | null),
    balance: amountString(r.balance as number) ?? "0",
  }));
}

export type SaleDraft = {
  id: string;
  name: string | null;
  customerId: string | null;
  customerName?: string | null;
  items: Array<Record<string, unknown>>;
  updatedAt: string;
};

export async function listDrafts(branchId: string): Promise<SaleDraft[]> {
  const supabase = await client();
  // RLS limits this to the signed-in user's own saved carts.
  const { data, error } = await supabase
    .from("sale_drafts")
    .select("id, name, customer_id, cart, updated_at")
    .eq("branch_id", branchId)
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error) raise(error, "pos.drafts");
  const rows = (data ?? []) as Row[];

  const customerIds = [...new Set(rows.map((r) => str(r.customer_id)).filter((v): v is string => v !== null))];
  const names = new Map<string, string>();
  if (customerIds.length > 0) {
    const { data: customers } = await supabase.from("customers").select("id, name").in("id", customerIds);
    for (const c of (customers ?? []) as Row[]) names.set(String(c.id), String(c.name));
  }

  return rows.map((r) => ({
    id: String(r.id),
    name: str(r.name),
    customerId: str(r.customer_id),
    customerName: names.get(String(r.customer_id)) ?? null,
    items: Array.isArray(r.cart) ? (r.cart as Array<Record<string, unknown>>) : [],
    updatedAt: String(r.updated_at),
  }));
}

export type Quote = {
  lines: Array<{
    lineNo: number;
    medicineId: string;
    name: string;
    strength: string | null;
    unit: string;
    quantity: number;
    prescriptionRequired: boolean;
    gross: string;
    discount: string;
    taxAmount: string;
    lineTotal: string;
    batches: number;
    /** Only present for roles that may see them. */
    profit: string | null;
  }>;
  totals: {
    subtotal: string;
    discountTotal: string;
    taxTotal: string;
    grandTotal: string;
    profitTotal: string | null;
  };
};

export type QuoteFailure = { code: string; message: string; reference?: string; hint: Record<string, unknown> | null };

function parseHint(hint: unknown): Record<string, unknown> | null {
  if (typeof hint !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(hint);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Database hints carry only ids and counts (never row text), so they are safe to pass on. */
export function failureFrom(error: unknown, context: string): QuoteFailure {
  const mapped = mapError(error, context);
  const hint = typeof error === "object" && error !== null ? parseHint((error as { hint?: unknown }).hint) : null;
  return { code: mapped.code, message: mapped.message, reference: mapped.reference, hint };
}

export async function quoteSale(
  branchId: string,
  items: Array<Record<string, unknown>>,
): Promise<{ ok: true; quote: Quote } | { ok: false; failure: QuoteFailure }> {
  const supabase = await client();
  const { data, error } = await supabase.rpc("quote_sale", { p_branch: branchId, p_items: items });
  if (error) return { ok: false, failure: failureFrom(error, "pos.quote") };

  const r = data as {
    lines: Row[];
    totals: Record<string, string | undefined>;
  };
  return {
    ok: true,
    quote: {
      lines: r.lines.map((l) => ({
        lineNo: Number(l.line_no),
        medicineId: String(l.medicine_id),
        name: String(l.name),
        strength: str(l.strength),
        unit: String(l.unit),
        quantity: Number(l.quantity),
        prescriptionRequired: Boolean(l.prescription_required),
        gross: String(l.gross),
        discount: String(l.discount),
        taxAmount: String(l.tax_amount),
        lineTotal: String(l.line_total),
        batches: Array.isArray(l.allocations) ? l.allocations.length : 1,
        profit: str(l.profit),
      })),
      totals: {
        subtotal: String(r.totals.subtotal),
        discountTotal: String(r.totals.discount_total),
        taxTotal: String(r.totals.tax_total),
        grandTotal: String(r.totals.grand_total),
        profitTotal: r.totals.profit_total ?? null,
      },
    },
  };
}

export type Invoice = {
  id: string;
  invoiceNo: string;
  soldAt: string;
  branch: { name: string; address: string | null; phone: string | null; currency: string; invoiceFooter: string | null; vatRegistration: string | null };
  customer: { id: string; name: string; phone: string | null } | null;
  cashier: string | null;
  notes: string | null;
  items: Array<{
    lineNo: number;
    name: string;
    strength: string | null;
    unit: string;
    quantity: number;
    unitPrice: string | null;
    gross: string;
    discount: string;
    taxRate: string;
    taxAmount: string;
    lineTotal: string;
    batches: Array<{ batchNumber: string; expiryDate: string; quantity: number; unitPrice: string }>;
  }>;
  payments: Array<{ method: string; amount: string; reference: string | null }>;
  totals: { subtotal: string; discountTotal: string; taxTotal: string; grandTotal: string; paidTotal: string; dueTotal: string };
};

export function invoiceFromJson(raw: unknown): Invoice {
  const r = raw as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  return {
    id: String(r.id),
    invoiceNo: String(r.invoice_no),
    soldAt: String(r.sold_at),
    branch: {
      name: String(r.branch?.name ?? ""),
      address: str(r.branch?.address),
      phone: str(r.branch?.phone),
      currency: String(r.branch?.currency ?? "BDT"),
      invoiceFooter: str(r.branch?.invoice_footer),
      vatRegistration: str(r.branch?.vat_registration),
    },
    customer: r.customer ? { id: String(r.customer.id), name: String(r.customer.name), phone: str(r.customer.phone) } : null,
    cashier: str(r.cashier),
    notes: str(r.notes),
    items: (r.items ?? []).map((i: Record<string, any>) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
      lineNo: Number(i.line_no),
      name: String(i.name),
      strength: str(i.strength),
      unit: String(i.unit),
      quantity: Number(i.quantity),
      unitPrice: str(i.unit_price),
      gross: String(i.gross),
      discount: String(i.discount),
      taxRate: String(i.tax_rate),
      taxAmount: String(i.tax_amount),
      lineTotal: String(i.line_total),
      batches: (i.batches ?? []).map((b: Record<string, any>) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
        batchNumber: String(b.batch_number),
        expiryDate: String(b.expiry_date),
        quantity: Number(b.quantity),
        unitPrice: String(b.unit_price),
      })),
    })),
    payments: (r.payments ?? []).map((p: Record<string, any>) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
      method: String(p.method),
      amount: String(p.amount),
      reference: str(p.reference),
    })),
    totals: {
      subtotal: String(r.totals?.subtotal),
      discountTotal: String(r.totals?.discount_total),
      taxTotal: String(r.totals?.tax_total),
      grandTotal: String(r.totals?.grand_total),
      paidTotal: String(r.totals?.paid_total),
      dueTotal: String(r.totals?.due_total),
    },
  };
}

export async function getInvoice(saleId: string): Promise<Invoice | null> {
  const supabase = await client();
  const { data, error } = await supabase.rpc("get_invoice", { p_sale: saleId });
  if (error) {
    // A malformed id, a missing sale, or someone else's sale all look like "not found" to the user.
    if (error.code === "22P02" || error.code === "P0002" || error.code === "42501") return null;
    raise(error, "pos.invoice");
  }
  return invoiceFromJson(data);
}

export type SaleListItem = {
  saleId: string;
  invoiceNo: string;
  invoiceSeq: number;
  soldAt: string;
  customerName: string | null;
  itemCount: number;
  grandTotal: string;
  paidTotal: string;
  dueTotal: string;
  cashierName: string | null;
  profitTotal: string | null;
};

export async function listSales(
  branchId: string,
  filters: { query: string; from: string | null; to: string | null; beforeSeq: number | null },
  pageSize: number,
): Promise<{ items: SaleListItem[]; nextBefore: number | null }> {
  const supabase = await client();
  const { data, error } = await supabase.rpc("list_sales", {
    p_branch: branchId,
    p_query: filters.query,
    p_from: filters.from,
    p_to: filters.to,
    p_before_seq: filters.beforeSeq,
    p_limit: pageSize + 1,
  });
  if (error) raise(error, "pos.history");
  const rows = (data ?? []) as Row[];
  const page = rows.slice(0, pageSize);
  const last = page[page.length - 1];
  return {
    nextBefore: rows.length > pageSize && last ? Number(last.invoice_seq) : null,
    items: page.map((r) => ({
      saleId: String(r.sale_id),
      invoiceNo: String(r.invoice_no),
      invoiceSeq: Number(r.invoice_seq),
      soldAt: String(r.sold_at),
      customerName: str(r.customer_name),
      itemCount: Number(r.item_count ?? 0),
      grandTotal: amountString(r.grand_total as number) ?? "0",
      paidTotal: amountString(r.paid_total as number) ?? "0",
      dueTotal: amountString(r.due_total as number) ?? "0",
      cashierName: str(r.cashier_name),
      profitTotal: amountString(r.profit_total as number | null),
    })),
  };
}
