-- Phase 3 / 1 of 3: medicine catalogue, batches and stock movements (tables).
--
-- The catalogue (companies, categories, medicines) is organisation-wide: every
-- branch sells the same drugs. Stock (batches, movements) is per branch.
-- A medicine is NOT inventory; stock exists only in medicine_batches, and every
-- change to a batch quantity must be backed by a stock_movements row (enforced at
-- commit by a deferred constraint trigger).
--
-- Cost columns (medicines.default_purchase_price, medicine_batches.purchase_price)
-- are excluded from authenticated's column privileges in 20261001000007 and are
-- only reachable through functions that check purchase.view_cost.
--
-- Error codes introduced (mapped in src/server/errors.ts):
--   PH030 expiry_not_in_future        PH031 sale_price_above_mrp
--   PH033 price_permission_required   PH034 subcategory_mismatch
--   PH040 stock_invariant_violation

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------------
create table public.companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 120),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index companies_name_key on public.companies (lower(btrim(name)));
create index companies_name_trgm on public.companies using gin (name extensions.gin_trgm_ops);

create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 120),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index categories_name_key on public.categories (lower(btrim(name)));

create table public.subcategories (
  id           uuid primary key default gen_random_uuid(),
  category_id  uuid not null references public.categories (id) on delete restrict,
  name         text not null check (length(btrim(name)) between 1 and 120),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (category_id, id)
);
create unique index subcategories_name_key on public.subcategories (category_id, lower(btrim(name)));

create table public.medicines (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null check (length(btrim(name)) between 1 and 200),
  generic_name            text check (generic_name is null or length(generic_name) <= 200),
  brand_name              text check (brand_name is null or length(brand_name) <= 200),
  company_id              uuid references public.companies (id) on delete restrict,
  category_id             uuid references public.categories (id) on delete restrict,
  subcategory_id          uuid,
  strength                text check (strength is null or length(strength) <= 60),
  dosage_form             text check (dosage_form is null or length(dosage_form) <= 60),
  unit                    text not null default 'pcs' check (length(btrim(unit)) between 1 and 30),
  -- Units per pack (e.g. 10 tablets per strip). Stock is counted in single units.
  pack_size               integer not null default 1 check (pack_size > 0),
  barcode                 text check (barcode is null or length(btrim(barcode)) between 1 and 64),
  sku                     text check (sku is null or length(btrim(sku)) between 1 and 64),
  -- null means "not set"; a price is never silently 0.
  default_purchase_price  numeric(14,4) check (default_purchase_price is null or default_purchase_price >= 0),
  default_sale_price      numeric(14,4) check (default_sale_price is null or default_sale_price >= 0),
  mrp                     numeric(14,4) check (mrp is null or mrp >= 0),
  minimum_stock           integer not null default 0 check (minimum_stock >= 0),
  reorder_level           integer not null default 0 check (reorder_level >= 0),
  prescription_required   boolean not null default false,
  tax_rate                numeric(5,2) not null default 0 check (tax_rate between 0 and 100),
  description             text check (description is null or length(description) <= 2000),
  image_url               text check (image_url is null or length(image_url) <= 500),
  is_active               boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  created_by              uuid,
  -- A subcategory must belong to the chosen category (null subcategory skips this).
  foreign key (category_id, subcategory_id) references public.subcategories (category_id, id) on delete restrict,
  check (subcategory_id is null or category_id is not null),
  check (mrp is null or default_sale_price is null or default_sale_price <= mrp)
);
create unique index medicines_barcode_key on public.medicines (btrim(barcode)) where barcode is not null;
create unique index medicines_sku_key on public.medicines (lower(btrim(sku))) where sku is not null;
create index medicines_name_trgm on public.medicines using gin (name extensions.gin_trgm_ops);
create index medicines_generic_trgm on public.medicines using gin (generic_name extensions.gin_trgm_ops);
create index medicines_brand_trgm on public.medicines using gin (brand_name extensions.gin_trgm_ops);
create index medicines_name_sort on public.medicines (lower(name), id);
create index medicines_company_idx on public.medicines (company_id);
create index medicines_category_idx on public.medicines (category_id);

-- ---------------------------------------------------------------------------
-- Batches and stock movements (per branch)
-- ---------------------------------------------------------------------------
create table public.medicine_batches (
  id              uuid primary key default gen_random_uuid(),
  branch_id       uuid not null references public.branches (id) on delete restrict,
  medicine_id     uuid not null references public.medicines (id) on delete restrict,
  -- FK to suppliers is added in Phase 7 when that table exists.
  supplier_id     uuid,
  batch_number    text not null check (length(btrim(batch_number)) between 1 and 64),
  expiry_date     date not null,
  purchase_price  numeric(14,4) not null check (purchase_price >= 0),
  sale_price      numeric(14,4) not null check (sale_price >= 0),
  mrp             numeric(14,4) check (mrp is null or mrp >= 0),
  quantity        integer not null default 0 check (quantity >= 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  check (mrp is null or sale_price <= mrp),
  unique (id, branch_id, medicine_id)
);
-- The same batch number may exist for other medicines or suppliers. The same
-- medicine + supplier + batch number + expiry in a branch is one physical batch.
-- NULLS NOT DISTINCT so "no supplier" cannot be duplicated either.
create unique index medicine_batches_identity_key
  on public.medicine_batches (branch_id, medicine_id, supplier_id, batch_number, expiry_date)
  nulls not distinct;
-- FEFO: the next batch to sell for a medicine.
create index medicine_batches_fefo_idx
  on public.medicine_batches (branch_id, medicine_id, expiry_date)
  where quantity > 0;
-- Expiry reports.
create index medicine_batches_expiry_idx
  on public.medicine_batches (branch_id, expiry_date)
  where quantity > 0;

create table public.stock_movements (
  id              bigint generated always as identity primary key,
  branch_id       uuid not null,
  medicine_id     uuid not null,
  batch_id        uuid not null,
  quantity_delta  integer not null check (quantity_delta <> 0),
  movement_type   text not null check (movement_type in (
    'PURCHASE','SALE','SALE_RETURN','PURCHASE_RETURN','ADJUSTMENT',
    'DAMAGE','EXPIRED','TRANSFER','OPENING_STOCK','CORRECTION')),
  reference_type  text,
  reference_id    text,
  reason          text,
  user_id         uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  -- The movement must name the batch's own branch and medicine.
  foreign key (batch_id, branch_id, medicine_id)
    references public.medicine_batches (id, branch_id, medicine_id) on delete restrict,
  -- Direction is fixed for most types; adjustments and transfers can go either way.
  check (
    case movement_type
      when 'PURCHASE'        then quantity_delta > 0
      when 'SALE_RETURN'     then quantity_delta > 0
      when 'OPENING_STOCK'   then quantity_delta > 0
      when 'SALE'            then quantity_delta < 0
      when 'PURCHASE_RETURN' then quantity_delta < 0
      when 'DAMAGE'          then quantity_delta < 0
      when 'EXPIRED'         then quantity_delta < 0
      else true
    end
  ),
  -- Manual corrections must say why.
  check (movement_type not in ('ADJUSTMENT','DAMAGE','EXPIRED','CORRECTION')
         or length(btrim(coalesce(reason, ''))) > 0)
);
create index stock_movements_batch_idx on public.stock_movements (batch_id, created_at);
create index stock_movements_medicine_idx on public.stock_movements (medicine_id, created_at);
create index stock_movements_branch_idx on public.stock_movements (branch_id, created_at desc);
create index stock_movements_reference_idx on public.stock_movements (reference_type, reference_id);

-- ---------------------------------------------------------------------------
-- Housekeeping triggers
-- ---------------------------------------------------------------------------
create trigger companies_touch before update on public.companies
  for each row execute function public.touch_updated_at();
create trigger categories_touch before update on public.categories
  for each row execute function public.touch_updated_at();
create trigger subcategories_touch before update on public.subcategories
  for each row execute function public.touch_updated_at();
create trigger medicines_touch before update on public.medicines
  for each row execute function public.touch_updated_at();
create trigger medicine_batches_touch before update on public.medicine_batches
  for each row execute function public.touch_updated_at();

create trigger stock_movements_no_update before update or delete on public.stock_movements
  for each row execute function public.forbid_modification();
create trigger stock_movements_no_truncate before truncate on public.stock_movements
  for each statement execute function public.forbid_modification();

-- ---------------------------------------------------------------------------
-- The stock invariant: a batch's quantity always equals the sum of its movements.
-- Checked at COMMIT, so a writer may update both in any order inside a
-- transaction, but cannot commit one without the other.
-- ---------------------------------------------------------------------------
create function public.check_batch_stock_invariant() returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_batch uuid;
  v_qty integer;
  v_sum bigint;
begin
  if tg_table_name = 'medicine_batches' then
    v_batch := new.id;
  else
    v_batch := new.batch_id;
  end if;

  select b.quantity into v_qty from public.medicine_batches b where b.id = v_batch;
  select coalesce(sum(m.quantity_delta), 0) into v_sum
    from public.stock_movements m where m.batch_id = v_batch;

  if v_qty is distinct from v_sum then
    raise exception 'Batch % holds % but its stock movements add up to %', v_batch, v_qty, v_sum
      using errcode = 'PH040';
  end if;
  return null;
end $$;

create constraint trigger medicine_batches_stock_invariant
  after insert or update of quantity on public.medicine_batches
  deferrable initially deferred
  for each row execute function public.check_batch_stock_invariant();

create constraint trigger stock_movements_stock_invariant
  after insert on public.stock_movements
  deferrable initially deferred
  for each row execute function public.check_batch_stock_invariant();

-- ---------------------------------------------------------------------------
-- Audit: extend the generic row-change trigger to the new tables.
-- (Same function, same contract; only the table list grows.)
-- ---------------------------------------------------------------------------
create or replace function public.audit_row_change() returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_branch uuid;
  v_entity_id text;
begin
  case tg_table_name
    when 'branches' then
      v_branch := (v_row ->> 'id')::uuid;
      v_entity_id := v_row ->> 'id';
    when 'branch_members' then
      v_branch := (v_row ->> 'branch_id')::uuid;
      v_entity_id := (v_row ->> 'user_id') || ':' || (v_row ->> 'branch_id');
    when 'user_permission_overrides' then
      v_branch := (v_row ->> 'branch_id')::uuid;
      v_entity_id := (v_row ->> 'user_id') || ':' || (v_row ->> 'branch_id') || ':' || (v_row ->> 'permission');
    when 'role_permissions' then
      v_branch := null;
      v_entity_id := (v_row ->> 'role') || ':' || (v_row ->> 'permission');
    when 'profiles', 'companies', 'categories', 'subcategories', 'medicines' then
      v_branch := null;
      v_entity_id := v_row ->> 'id';
    when 'medicine_batches' then
      v_branch := (v_row ->> 'branch_id')::uuid;
      v_entity_id := v_row ->> 'id';
    else
      raise exception 'audit_row_change is not configured for %', tg_table_name;
  end case;

  insert into public.audit_log (branch_id, actor_id, action, entity_type, entity_id, old_values, new_values)
  values (
    v_branch,
    auth.uid(),
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    v_entity_id,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

create trigger companies_audit after insert or update or delete on public.companies
  for each row execute function public.audit_row_change();
create trigger categories_audit after insert or update or delete on public.categories
  for each row execute function public.audit_row_change();
create trigger subcategories_audit after insert or update or delete on public.subcategories
  for each row execute function public.audit_row_change();
create trigger medicines_audit after insert or update or delete on public.medicines
  for each row execute function public.audit_row_change();
create trigger medicine_batches_audit after insert or update or delete on public.medicine_batches
  for each row execute function public.audit_row_change();

revoke all on function public.check_batch_stock_invariant() from public;
