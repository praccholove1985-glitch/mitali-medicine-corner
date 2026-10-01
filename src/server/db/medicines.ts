import "server-only";
import { createClient } from "@/lib/supabase/server";
import { amountString } from "@/lib/medicine-payload";
import { mapError } from "@/server/errors";

/** Thrown to the route error boundary; carries only a safe message and a reference. */
export class DataError extends Error {
  constructor(
    message: string,
    public readonly reference?: string,
  ) {
    super(message);
    this.name = "DataError";
  }
}

async function client() {
  const supabase = await createClient();
  if (!supabase) throw new DataError("The database connection is not configured.");
  return supabase;
}

function raise(error: unknown, context: string): never {
  const mapped = mapError(error, context);
  throw new DataError(mapped.message, mapped.reference);
}

export type MedicineListItem = {
  id: string;
  name: string;
  genericName: string | null;
  brandName: string | null;
  companyName: string | null;
  strength: string | null;
  dosageForm: string | null;
  unit: string;
  barcode: string | null;
  sku: string | null;
  salePrice: string | null;
  mrp: string | null;
  reorderLevel: number;
  prescriptionRequired: boolean;
  isActive: boolean;
  /** null when the user may not see stock. Never defaulted to 0. */
  stockOnHand: number | null;
};

export type MedicinePage = { items: MedicineListItem[]; total: number };

export async function searchMedicines(
  branchId: string,
  query: string,
  page: number,
  pageSize: number,
  includeInactive: boolean,
): Promise<MedicinePage> {
  const supabase = await client();
  const { data, error } = await supabase.rpc("search_medicines", {
    p_branch: branchId,
    p_query: query,
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
    p_include_inactive: includeInactive,
  });
  if (error) raise(error, "medicines.search");

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  return {
    total: rows.length > 0 ? Number(rows[0]?.total_count ?? 0) : 0,
    items: rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      genericName: (r.generic_name as string | null) ?? null,
      brandName: (r.brand_name as string | null) ?? null,
      companyName: (r.company_name as string | null) ?? null,
      strength: (r.strength as string | null) ?? null,
      dosageForm: (r.dosage_form as string | null) ?? null,
      unit: String(r.unit),
      barcode: (r.barcode as string | null) ?? null,
      sku: (r.sku as string | null) ?? null,
      salePrice: amountString(r.default_sale_price as number | null),
      mrp: amountString(r.mrp as number | null),
      reorderLevel: Number(r.reorder_level ?? 0),
      prescriptionRequired: Boolean(r.prescription_required),
      isActive: Boolean(r.is_active),
      stockOnHand: r.stock_on_hand === null || r.stock_on_hand === undefined ? null : Number(r.stock_on_hand),
    })),
  };
}

export type MedicineDetail = {
  id: string;
  name: string;
  genericName: string | null;
  brandName: string | null;
  companyId: string | null;
  categoryId: string | null;
  subcategoryId: string | null;
  strength: string | null;
  dosageForm: string | null;
  unit: string;
  packSize: number;
  barcode: string | null;
  sku: string | null;
  salePrice: string | null;
  mrp: string | null;
  minimumStock: number;
  reorderLevel: number;
  prescriptionRequired: boolean;
  taxRate: string;
  description: string | null;
  isActive: boolean;
};

const MEDICINE_COLUMNS =
  "id, name, generic_name, brand_name, company_id, category_id, subcategory_id, strength, dosage_form, unit, pack_size, barcode, sku, default_sale_price, mrp, minimum_stock, reorder_level, prescription_required, tax_rate, description, is_active";

export async function getMedicine(id: string): Promise<MedicineDetail | null> {
  const supabase = await client();
  const { data, error } = await supabase.from("medicines").select(MEDICINE_COLUMNS).eq("id", id).maybeSingle();
  if (error) {
    // A malformed id is "not found", not a server fault.
    if (error.code === "22P02") return null;
    raise(error, "medicines.get");
  }
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return {
    id: String(r.id),
    name: String(r.name),
    genericName: (r.generic_name as string | null) ?? null,
    brandName: (r.brand_name as string | null) ?? null,
    companyId: (r.company_id as string | null) ?? null,
    categoryId: (r.category_id as string | null) ?? null,
    subcategoryId: (r.subcategory_id as string | null) ?? null,
    strength: (r.strength as string | null) ?? null,
    dosageForm: (r.dosage_form as string | null) ?? null,
    unit: String(r.unit),
    packSize: Number(r.pack_size),
    barcode: (r.barcode as string | null) ?? null,
    sku: (r.sku as string | null) ?? null,
    salePrice: amountString(r.default_sale_price as number | null),
    mrp: amountString(r.mrp as number | null),
    minimumStock: Number(r.minimum_stock),
    reorderLevel: Number(r.reorder_level),
    prescriptionRequired: Boolean(r.prescription_required),
    taxRate: amountString(r.tax_rate as number | string) ?? "0",
    description: (r.description as string | null) ?? null,
    isActive: Boolean(r.is_active),
  };
}

/** Only call for users holding purchase.view_cost; the database refuses everyone else. */
export async function getDefaultCost(medicineId: string): Promise<string | null> {
  const supabase = await client();
  const { data, error } = await supabase.rpc("medicine_default_cost", { p_medicine: medicineId });
  if (error) raise(error, "medicines.cost");
  return amountString(data as number | null);
}

export type CatalogueOption = { id: string; name: string; isActive: boolean };
export type SubcategoryOption = CatalogueOption & { categoryId: string };

export type Catalogue = {
  companies: CatalogueOption[];
  categories: CatalogueOption[];
  subcategories: SubcategoryOption[];
};

export async function getCatalogue(): Promise<Catalogue> {
  const supabase = await client();
  const [companies, categories, subcategories] = await Promise.all([
    supabase.from("companies").select("id, name, is_active").order("name"),
    supabase.from("categories").select("id, name, is_active").order("name"),
    supabase.from("subcategories").select("id, name, is_active, category_id").order("name"),
  ]);
  if (companies.error) raise(companies.error, "catalogue.companies");
  if (categories.error) raise(categories.error, "catalogue.categories");
  if (subcategories.error) raise(subcategories.error, "catalogue.subcategories");

  const option = (r: Record<string, unknown>): CatalogueOption => ({
    id: String(r.id),
    name: String(r.name),
    isActive: Boolean(r.is_active),
  });
  return {
    companies: (companies.data ?? []).map(option),
    categories: (categories.data ?? []).map(option),
    subcategories: (subcategories.data ?? []).map((r) => ({
      ...option(r),
      categoryId: String((r as Record<string, unknown>).category_id),
    })),
  };
}

export type BatchRow = {
  id: string;
  batchNumber: string;
  expiryDate: string;
  daysToExpiry: number;
  isExpired: boolean;
  /** null unless the user holds purchase.view_cost. */
  purchasePrice: string | null;
  salePrice: string;
  mrp: string | null;
  quantity: number;
};

export async function listBatches(branchId: string, medicineId: string): Promise<BatchRow[]> {
  const supabase = await client();
  const { data, error } = await supabase.rpc("list_batches", { p_branch: branchId, p_medicine: medicineId });
  if (error) raise(error, "batches.list");
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    batchNumber: String(r.batch_number),
    expiryDate: String(r.expiry_date),
    daysToExpiry: Number(r.days_to_expiry),
    isExpired: Boolean(r.is_expired),
    purchasePrice: amountString(r.purchase_price as number | null),
    salePrice: amountString(r.sale_price as number) ?? "0",
    mrp: amountString(r.mrp as number | null),
    quantity: Number(r.quantity),
  }));
}
