import "server-only";
import { createClient } from "@/lib/supabase/server";
import { mapError } from "@/server/errors";
import { DataError } from "@/server/db/medicines";
import type { CustomerFilter } from "@/lib/validation/customer";

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

export type DueSummary = {
  /** Display only: the database adds these up. */
  totalDue: string;
  customersWithDue: number;
  customersOverLimit: number;
  activeCustomers: number;
  advanceTotal: string;
};

export async function getDueSummary(branchId: string): Promise<DueSummary> {
  const supabase = await client();
  const { data, error } = await supabase.rpc("due_summary", { p_branch: branchId });
  if (error) raise(error, "customers.due_summary");
  const r = ((data ?? []) as Row[])[0] ?? {};
  return {
    totalDue: String(r.total_due ?? "0"),
    customersWithDue: Number(r.customers_with_due ?? 0),
    customersOverLimit: Number(r.customers_over_limit ?? 0),
    activeCustomers: Number(r.active_customers ?? 0),
    advanceTotal: String(r.advance_total ?? "0"),
  };
}

export type CustomerRow = {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  creditLimit: string | null;
  isActive: boolean;
  balance: string;
  lastActivity: string | null;
  overLimit: boolean;
};

export async function listCustomers(
  branchId: string,
  query: string,
  filter: CustomerFilter,
  page: number,
  pageSize: number,
): Promise<{ items: CustomerRow[]; total: number }> {
  const supabase = await client();
  const { data, error } = await supabase.rpc("list_customers", {
    p_branch: branchId,
    p_query: query,
    p_filter: filter,
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
  });
  if (error) raise(error, "customers.list");
  const rows = (data ?? []) as Row[];
  return {
    items: rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      phone: str(r.phone),
      address: str(r.address),
      creditLimit: str(r.credit_limit),
      isActive: r.is_active === true,
      balance: String(r.balance ?? "0"),
      lastActivity: str(r.last_activity),
      overLimit: r.over_limit === true,
    })),
    total: Number(rows[0]?.total_count ?? 0),
  };
}

export type CustomerSummary = {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  creditLimit: string | null;
  isActive: boolean;
  createdAt: string;
  balance: string;
  availableCredit: string | null;
  salesCount: number;
  salesTotal: string;
  lastSaleAt: string | null;
  lastPaymentAt: string | null;
  canEdit: boolean;
  canReceivePayment: boolean;
};

export async function getCustomerSummary(branchId: string, customerId: string): Promise<CustomerSummary | null> {
  const supabase = await client();
  const { data, error } = await supabase.rpc("customer_summary", { p_branch: branchId, p_customer: customerId });
  if (error) raise(error, "customers.summary");
  if (!data) return null;
  const r = data as Row;
  return {
    id: String(r.id),
    name: String(r.name),
    phone: str(r.phone),
    address: str(r.address),
    creditLimit: str(r.credit_limit),
    isActive: r.is_active === true,
    createdAt: String(r.created_at),
    balance: String(r.balance ?? "0"),
    availableCredit: str(r.available_credit),
    salesCount: Number(r.sales_count ?? 0),
    salesTotal: String(r.sales_total ?? "0"),
    lastSaleAt: str(r.last_sale_at),
    lastPaymentAt: str(r.last_payment_at),
    canEdit: r.can_edit === true,
    canReceivePayment: r.can_receive_payment === true,
  };
}

export type StatementEntry = {
  id: number;
  at: string;
  type: "SALE_DUE" | "PAYMENT" | "RETURN_CREDIT" | "OPENING_BALANCE" | "ADJUSTMENT";
  amount: string;
  running: string;
  invoiceNo: string | null;
  saleId: string | null;
  method: string | null;
  reference: string | null;
  note: string | null;
  by: string | null;
};

export type Statement = {
  from: string;
  to: string;
  opening: string;
  closing: string;
  totalCharges: string;
  totalCredits: string;
  entryCount: number;
  truncated: boolean;
  entries: StatementEntry[];
};

export async function getStatement(branchId: string, customerId: string, from: string, to: string): Promise<Statement> {
  const supabase = await client();
  const { data, error } = await supabase.rpc("customer_statement", {
    p_branch: branchId,
    p_customer: customerId,
    p_from: from,
    p_to: to,
  });
  if (error) raise(error, "customers.statement");
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
      type: String(e.type) as StatementEntry["type"],
      amount: String(e.amount),
      running: String(e.running),
      invoiceNo: str(e.invoice_no),
      saleId: str(e.sale_id),
      method: str(e.method),
      reference: str(e.reference),
      note: str(e.note),
      by: str(e.by),
    })),
  };
}
