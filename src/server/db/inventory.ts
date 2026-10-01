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
const nullableString = (v: unknown) => (v === null || v === undefined ? null : String(v));

export type InventorySummary = {
  stockedMedicines: number;
  sellableUnits: number;
  lowStockCount: number;
  outOfStockCount: number;
  expiring30Batches: number;
  expiredBatches: number;
  expiredUnits: number;
  /** null unless the user holds purchase.view_cost. Display only; never add these up in the browser. */
  valueAtCost: string | null;
  expiredValueAtCost: string | null;
};

export async function getInventorySummary(branchId: string): Promise<InventorySummary> {
  const supabase = await client();
  const { data, error } = await supabase.rpc("inventory_summary", { p_branch: branchId });
  if (error) raise(error, "inventory.summary");
  const r = ((data ?? []) as Row[])[0] ?? {};
  return {
    stockedMedicines: Number(r.stocked_medicines ?? 0),
    sellableUnits: Number(r.sellable_units ?? 0),
    lowStockCount: Number(r.low_stock_count ?? 0),
    outOfStockCount: Number(r.out_of_stock_count ?? 0),
    expiring30Batches: Number(r.expiring_30_batches ?? 0),
    expiredBatches: Number(r.expired_batches ?? 0),
    expiredUnits: Number(r.expired_units ?? 0),
    valueAtCost: amountString(r.value_at_cost as number | null),
    expiredValueAtCost: amountString(r.expired_value_at_cost as number | null),
  };
}

export type StockFilter = "all" | "in_stock" | "low" | "out" | "expiring" | "expired";
export const STOCK_FILTERS: readonly StockFilter[] = ["in_stock", "low", "out", "expiring", "expired", "all"];

export type StockItem = {
  medicineId: string;
  name: string;
  genericName: string | null;
  companyName: string | null;
  strength: string | null;
  dosageForm: string | null;
  unit: string;
  reorderLevel: number;
  isActive: boolean;
  sellableQty: number;
  expiredQty: number;
  batchCount: number;
  nearestExpiry: string | null;
  nearestExpiryDays: number | null;
  valueAtCost: string | null;
};

export async function listStock(
  branchId: string,
  query: string,
  filter: StockFilter,
  page: number,
  pageSize: number,
): Promise<{ items: StockItem[]; total: number }> {
  const supabase = await client();
  const { data, error } = await supabase.rpc("list_stock", {
    p_branch: branchId,
    p_query: query,
    p_filter: filter,
    p_days: 90,
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
  });
  if (error) raise(error, "inventory.list");
  const rows = (data ?? []) as Row[];
  return {
    total: rows.length > 0 ? Number(rows[0]?.total_count ?? 0) : 0,
    items: rows.map((r) => ({
      medicineId: String(r.medicine_id),
      name: String(r.name),
      genericName: nullableString(r.generic_name),
      companyName: nullableString(r.company_name),
      strength: nullableString(r.strength),
      dosageForm: nullableString(r.dosage_form),
      unit: String(r.unit),
      reorderLevel: Number(r.reorder_level ?? 0),
      isActive: Boolean(r.is_active),
      sellableQty: Number(r.sellable_qty ?? 0),
      expiredQty: Number(r.expired_qty ?? 0),
      batchCount: Number(r.batch_count ?? 0),
      nearestExpiry: nullableString(r.nearest_expiry),
      nearestExpiryDays: r.nearest_expiry_days === null || r.nearest_expiry_days === undefined ? null : Number(r.nearest_expiry_days),
      valueAtCost: amountString(r.value_at_cost as number | null),
    })),
  };
}

export type ExpiryBucketKey = "expired" | "d30" | "d60" | "d90";
export type ExpiryBucketFilter = ExpiryBucketKey | "all";
export const EXPIRY_BUCKET_FILTERS: readonly ExpiryBucketFilter[] = ["all", "expired", "d30", "d60", "d90"];

export type ExpiryBucket = { bucket: ExpiryBucketKey; batches: number; units: number; valueAtCost: string | null };

export async function getExpiryBuckets(branchId: string): Promise<ExpiryBucket[]> {
  const supabase = await client();
  const { data, error } = await supabase.rpc("expiry_buckets", { p_branch: branchId });
  if (error) raise(error, "inventory.buckets");
  return ((data ?? []) as Row[]).map((r) => ({
    bucket: String(r.bucket) as ExpiryBucketKey,
    batches: Number(r.batch_count ?? 0),
    units: Number(r.units ?? 0),
    valueAtCost: amountString(r.value_at_cost as number | null),
  }));
}

export type ExpiryItem = {
  batchId: string;
  medicineId: string;
  medicineName: string;
  strength: string | null;
  batchNumber: string;
  expiryDate: string;
  daysToExpiry: number;
  quantity: number;
  valueAtCost: string | null;
};

export async function listExpiry(
  branchId: string,
  bucket: ExpiryBucketFilter,
  page: number,
  pageSize: number,
): Promise<{ items: ExpiryItem[]; total: number }> {
  const supabase = await client();
  const { data, error } = await supabase.rpc("list_expiry", {
    p_branch: branchId,
    p_bucket: bucket,
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
  });
  if (error) raise(error, "inventory.expiry");
  const rows = (data ?? []) as Row[];
  return {
    total: rows.length > 0 ? Number(rows[0]?.total_count ?? 0) : 0,
    items: rows.map((r) => ({
      batchId: String(r.batch_id),
      medicineId: String(r.medicine_id),
      medicineName: String(r.medicine_name),
      strength: nullableString(r.strength),
      batchNumber: String(r.batch_number),
      expiryDate: String(r.expiry_date),
      daysToExpiry: Number(r.days_to_expiry),
      quantity: Number(r.quantity),
      valueAtCost: amountString(r.value_at_cost as number | null),
    })),
  };
}

export type MovementItem = {
  id: number;
  createdAt: string;
  movementType: string;
  quantityDelta: number;
  reason: string | null;
  referenceType: string | null;
  medicineId: string;
  medicineName: string;
  batchId: string;
  batchNumber: string;
  userName: string | null;
};

/** Newest first. `before` is the id of the last row already shown. */
export async function listMovements(
  branchId: string,
  filters: { medicineId?: string | null; batchId?: string | null; type?: string | null; before?: number | null },
  pageSize: number,
): Promise<{ items: MovementItem[]; nextBefore: number | null }> {
  const supabase = await client();
  // Ask for one extra row to learn whether there is another page.
  const { data, error } = await supabase.rpc("list_stock_movements", {
    p_branch: branchId,
    p_medicine: filters.medicineId ?? null,
    p_batch: filters.batchId ?? null,
    p_type: filters.type ?? null,
    p_before: filters.before ?? null,
    p_limit: pageSize + 1,
  });
  if (error) raise(error, "inventory.movements");
  const rows = (data ?? []) as Row[];
  const page = rows.slice(0, pageSize);
  const last = page[page.length - 1];
  return {
    nextBefore: rows.length > pageSize && last ? Number(last.id) : null,
    items: page.map((r) => ({
      id: Number(r.id),
      createdAt: String(r.created_at),
      movementType: String(r.movement_type),
      quantityDelta: Number(r.quantity_delta),
      reason: nullableString(r.reason),
      referenceType: nullableString(r.reference_type),
      medicineId: String(r.medicine_id),
      medicineName: String(r.medicine_name),
      batchId: String(r.batch_id),
      batchNumber: String(r.batch_number),
      userName: nullableString(r.user_name),
    })),
  };
}
