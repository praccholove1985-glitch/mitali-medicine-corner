import "server-only";
import { createClient } from "@/lib/supabase/server";
import { mapError } from "@/server/errors";
import { DataError } from "@/server/db/medicines";
import type { SupplierFilter } from "@/lib/validation/supplier";

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

export type SupplierDueSummary = {
  /** Display only: the database adds these up. */
  totalPayable: string;
  suppliersWithDue: number;
  activeSuppliers: number;
  advanceTotal: string;
};

export async function getSupplierDueSummary(branchId: string): Promise<SupplierDueSummary> {
  const supabase = await client();
  const { data, error } = await supabase.rpc("supplier_due_summary", { p_branch: branchId });
  if (error) raise(error, "suppliers.due_summary");
  const r = ((data ?? []) as Row[])[0] ?? {};
  return {
    totalPayable: String(r.total_payable ?? "0"),
    suppliersWithDue: Number(r.suppliers_with_due ?? 0),
    activeSuppliers: Number(r.active_suppliers ?? 0),
    advanceTotal: String(r.advance_total ?? "0"),
  };
}

export type SupplierRow = {
  id: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  address: string | null;
  isActive: boolean;
  balance: string;
  lastActivity: string | null;
};

export async function listSuppliers(
  branchId: string,
  query: string,
  filter: SupplierFilter,
  page: number,
  pageSize: number,
): Promise<{ items: SupplierRow[]; total: number }> {
  const supabase = await client();
  const { data, error } = await supabase.rpc("list_suppliers", {
    p_branch: branchId,
    p_query: query,
    p_filter: filter,
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
  });
  if (error) raise(error, "suppliers.list");
  const rows = (data ?? []) as Row[];
  return {
    items: rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      contactPerson: str(r.contact_person),
      phone: str(r.phone),
      address: str(r.address),
      isActive: r.is_active === true,
      balance: String(r.balance ?? "0"),
      lastActivity: str(r.last_activity),
    })),
    total: Number(rows[0]?.total_count ?? 0),
  };
}

export async function searchSuppliers(branchId: string, query: string): Promise<Array<{ id: string; name: string; phone: string | null }>> {
  const supabase = await client();
  const { data, error } = await supabase.rpc("search_suppliers", { p_branch: branchId, p_query: query, p_limit: 10 });
  if (error) raise(error, "suppliers.search");
  return ((data ?? []) as Row[]).map((r) => ({ id: String(r.id), name: String(r.name), phone: str(r.phone) }));
}

export type SupplierSummary = {
  id: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  address: string | null;
  isActive: boolean;
  createdAt: string;
  balance: string;
  /** null unless the user holds purchase.view and purchase.view_cost. */
  purchasesCount: number | null;
  purchasesTotal: string | null;
  lastPurchaseAt: string | null;
  lastPaymentAt: string | null;
  canEdit: boolean;
  canPay: boolean;
  canPurchase: boolean;
};

export async function getSupplierSummary(branchId: string, supplierId: string): Promise<SupplierSummary | null> {
  const supabase = await client();
  const { data, error } = await supabase.rpc("supplier_summary", { p_branch: branchId, p_supplier: supplierId });
  if (error) raise(error, "suppliers.summary");
  if (!data) return null;
  const r = data as Row;
  return {
    id: String(r.id),
    name: String(r.name),
    contactPerson: str(r.contact_person),
    phone: str(r.phone),
    address: str(r.address),
    isActive: r.is_active === true,
    createdAt: String(r.created_at),
    balance: String(r.balance ?? "0"),
    purchasesCount: r.purchases_count === null || r.purchases_count === undefined ? null : Number(r.purchases_count),
    purchasesTotal: str(r.purchases_total),
    lastPurchaseAt: str(r.last_purchase_at),
    lastPaymentAt: str(r.last_payment_at),
    canEdit: r.can_edit === true,
    canPay: r.can_pay === true,
    canPurchase: r.can_purchase === true,
  };
}

export type SupplierStatementEntry = {
  id: number;
  at: string;
  type: "PURCHASE_DUE" | "PAYMENT" | "RETURN_CREDIT" | "OPENING_BALANCE" | "ADJUSTMENT";
  amount: string;
  running: string;
  purchaseNo: string | null;
  purchaseId: string | null;
  supplierInvoiceNo: string | null;
  method: string | null;
  reference: string | null;
  note: string | null;
  by: string | null;
};

export type SupplierStatement = {
  from: string;
  to: string;
  opening: string;
  closing: string;
  totalCharges: string;
  totalCredits: string;
  entryCount: number;
  truncated: boolean;
  entries: SupplierStatementEntry[];
};

export async function getSupplierStatement(branchId: string, supplierId: string, from: string, to: string): Promise<SupplierStatement> {
  const supabase = await client();
  const { data, error } = await supabase.rpc("supplier_statement", {
    p_branch: branchId,
    p_supplier: supplierId,
    p_from: from,
    p_to: to,
  });
  if (error) raise(error, "suppliers.statement");
  const r = (data ?? {}) as Row;
  const entries = Array.isArray(r.entries) ? (r.entries as Row[]) : [];
  return {
    from: String(r.from ?? from),
    to: String(r.to ?? to),
    opening: String(r.opening ?? "0"),
    closing: String(r.closing ?? "0"),
    totalCharges: String(r.total_charges ?? "0"),
    totalCredits: String(r.total_credits ?? "0"),
    entryCount: Number(r.entry_count ?? 0),
    truncated: r.truncated === true,
    entries: entries.map((e) => ({
      id: Number(e.id),
      at: String(e.at),
      type: String(e.type) as SupplierStatementEntry["type"],
      amount: String(e.amount),
      running: String(e.running),
      purchaseNo: str(e.purchase_no),
      purchaseId: str(e.purchase_id),
      supplierInvoiceNo: str(e.supplier_invoice_no),
      method: str(e.method),
      reference: str(e.reference),
      note: str(e.note),
      by: str(e.by),
    })),
  };
}
