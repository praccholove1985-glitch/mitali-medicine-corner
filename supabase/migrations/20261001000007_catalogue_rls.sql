-- Phase 3 / 3 of 3: row-level security and privileges for the new tables.
-- Same rules as Phase 1: default deny, SELECT through policies, no direct writes.

alter table public.companies         enable row level security;
alter table public.categories        enable row level security;
alter table public.subcategories     enable row level security;
alter table public.medicines         enable row level security;
alter table public.medicine_batches  enable row level security;
alter table public.stock_movements   enable row level security;

revoke all on public.companies, public.categories, public.subcategories,
  public.medicines, public.medicine_batches, public.stock_movements
  from anon, authenticated;

grant select on public.companies, public.categories, public.subcategories to authenticated;

-- Cost columns are left out on purpose: select * fails, and cost is returned only
-- by functions that check purchase.view_cost.
grant select (
  id, name, generic_name, brand_name, company_id, category_id, subcategory_id,
  strength, dosage_form, unit, pack_size, barcode, sku,
  default_sale_price, mrp, minimum_stock, reorder_level,
  prescription_required, tax_rate, description, image_url, is_active,
  created_at, updated_at, created_by
) on public.medicines to authenticated;

grant select (
  id, branch_id, medicine_id, supplier_id, batch_number, expiry_date,
  sale_price, mrp, quantity, created_at, updated_at, created_by
) on public.medicine_batches to authenticated;

grant select on public.stock_movements to authenticated;

-- (select ...) makes Postgres evaluate the permission once per query, not per row.
create policy companies_select on public.companies
  for select to authenticated
  using ((select public.has_permission_any('medicine.view')));

create policy categories_select on public.categories
  for select to authenticated
  using ((select public.has_permission_any('medicine.view')));

create policy subcategories_select on public.subcategories
  for select to authenticated
  using ((select public.has_permission_any('medicine.view')));

create policy medicines_select on public.medicines
  for select to authenticated
  using ((select public.has_permission_any('medicine.view')));

create policy medicine_batches_select on public.medicine_batches
  for select to authenticated
  using (public.has_permission(branch_id, 'stock.view'));

create policy stock_movements_select on public.stock_movements
  for select to authenticated
  using (public.has_permission(branch_id, 'stock.view'));
