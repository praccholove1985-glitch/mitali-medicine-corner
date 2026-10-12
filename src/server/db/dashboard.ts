import "server-only";

import { createClient } from "@/lib/supabase/server";
import { mapError } from "@/server/errors";
import { DataError } from "@/server/db/medicines";

async function client() {
  const supabase = await createClient();
  if (!supabase) throw new DataError("The database connection is not configured.");
  return supabase;
}

function raise(error: unknown): never {
  const mapped = mapError(error, "dashboard.overview");
  throw new DataError(mapped.message, mapped.reference);
}

type Row = Record<string, unknown>;

function decimal(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function count(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

export type DashboardDay = {
  day: string;
  salesTotal: string | null;
  salesCount: number | null;
  grossProfit: string | null;
  purchaseTotal: string | null;
  purchaseCount: number | null;
};

/**
 * Daily dashboard totals are aggregated in Postgres and individually masked
 * by the caller's permissions. Never add up invoice rows in the browser.
 */
export async function getDashboardOverview(
  branchId: string,
  from: string,
  to: string,
): Promise<DashboardDay[]> {
  const supabase = await client();
  const { data, error } = await supabase.rpc("dashboard_overview", {
    p_branch: branchId,
    p_from: from,
    p_to: to,
  });
  if (error) raise(error);

  return ((data ?? []) as Row[]).map((row) => ({
    day: String(row.day),
    salesTotal: decimal(row.sales_total),
    salesCount: count(row.sales_count),
    grossProfit: decimal(row.gross_profit),
    purchaseTotal: decimal(row.purchase_total),
    purchaseCount: count(row.purchase_count),
  }));
}
