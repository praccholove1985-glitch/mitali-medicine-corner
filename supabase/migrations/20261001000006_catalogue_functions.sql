-- Phase 3 / 2 of 3: permission helpers and the functions that write the
-- catalogue and batches. Clients never write these tables directly.
--
-- Every function is SECURITY DEFINER, pins search_path, derives the actor from
-- auth.uid() and checks the permission itself.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Catalogue data is organisation-wide, so its permission is "in any branch".
create function public.has_permission_any(p_permission text) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.my_branches() as b
    where public.has_permission(b, p_permission)
  )
$$;

create function public.require_permission_any(p_permission text) returns void
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_permission_any(p_permission) then
    raise exception 'permission denied: %', p_permission using errcode = '42501';
  end if;
end $$;

create function public.require_permission(p_branch uuid, p_permission text) returns void
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if p_branch is null or not public.has_permission(p_branch, p_permission) then
    raise exception 'permission denied: %', p_permission using errcode = '42501';
  end if;
end $$;

-- Today's date in the branch's own timezone. A batch dated today is expired.
create function public.branch_today(p_branch uuid) returns date
language sql stable security definer
set search_path = public, pg_temp
as $$
  select (now() at time zone b.timezone)::date from public.branches b where b.id = p_branch
$$;

revoke all on function public.has_permission_any(text) from public;
revoke all on function public.require_permission_any(text) from public;
revoke all on function public.require_permission(uuid, text) from public;
revoke all on function public.branch_today(uuid) from public;
grant execute on function public.has_permission_any(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Companies, categories, subcategories
-- ---------------------------------------------------------------------------
create function public.save_company(p_id uuid, p_name text, p_is_active boolean default true)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  perform public.require_permission_any('medicine.edit');
  if p_id is null then
    insert into public.companies (name, is_active)
    values (btrim(p_name), coalesce(p_is_active, true))
    returning id into v_id;
  else
    update public.companies set name = btrim(p_name), is_active = coalesce(p_is_active, true)
     where id = p_id returning id into v_id;
    if v_id is null then raise exception 'company not found' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;

create function public.save_category(p_id uuid, p_name text, p_is_active boolean default true)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  perform public.require_permission_any('medicine.edit');
  if p_id is null then
    insert into public.categories (name, is_active)
    values (btrim(p_name), coalesce(p_is_active, true))
    returning id into v_id;
  else
    update public.categories set name = btrim(p_name), is_active = coalesce(p_is_active, true)
     where id = p_id returning id into v_id;
    if v_id is null then raise exception 'category not found' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;

create function public.save_subcategory(p_id uuid, p_category_id uuid, p_name text, p_is_active boolean default true)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  perform public.require_permission_any('medicine.edit');
  if p_id is null then
    insert into public.subcategories (category_id, name, is_active)
    values (p_category_id, btrim(p_name), coalesce(p_is_active, true))
    returning id into v_id;
  else
    -- A subcategory cannot be moved to another category once medicines use it.
    update public.subcategories set name = btrim(p_name), is_active = coalesce(p_is_active, true)
     where id = p_id and category_id = p_category_id returning id into v_id;
    if v_id is null then raise exception 'subcategory not found' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Medicines
--
-- p is a JSON object of the fields to set. On create, `name` is required; on
-- update only the keys present change (null clears a nullable field).
-- Permissions: medicine.edit for everything, plus price.edit to set or change
-- default_purchase_price / default_sale_price. MRP is printed on the pack, so it
-- needs only medicine.edit.
-- ---------------------------------------------------------------------------
create function public.save_medicine(p_id uuid, p jsonb) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_allowed constant text[] := array[
    'name','generic_name','brand_name','company_id','category_id','subcategory_id',
    'strength','dosage_form','unit','pack_size','barcode','sku',
    'default_purchase_price','default_sale_price','mrp','minimum_stock','reorder_level',
    'prescription_required','tax_rate','description','image_url','is_active'];
  v_unknown text[];
  v_old public.medicines%rowtype;
  v_new public.medicines%rowtype;
begin
  perform public.require_permission_any('medicine.edit');

  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'p must be a JSON object' using errcode = '22023';
  end if;
  select array_agg(k) into v_unknown from jsonb_object_keys(p) k where k <> all (v_allowed);
  if v_unknown is not null then
    raise exception 'unknown medicine field(s): %', array_to_string(v_unknown, ', ') using errcode = '22023';
  end if;

  if p_id is null then
    if not (p ? 'name') then
      raise exception 'name is required' using errcode = '22023';
    end if;
    v_new.id := gen_random_uuid();
    v_new.unit := 'pcs';
    v_new.pack_size := 1;
    v_new.minimum_stock := 0;
    v_new.reorder_level := 0;
    v_new.prescription_required := false;
    v_new.tax_rate := 0;
    v_new.is_active := true;
    v_new.created_by := auth.uid();
    v_new.created_at := now();
    v_new.updated_at := now();
  else
    select * into v_old from public.medicines where id = p_id for update;
    if not found then raise exception 'medicine not found' using errcode = 'P0002'; end if;
    v_new := v_old;
  end if;

  if p ? 'name'                   then v_new.name := btrim(p ->> 'name'); end if;
  if p ? 'generic_name'           then v_new.generic_name := nullif(btrim(p ->> 'generic_name'), ''); end if;
  if p ? 'brand_name'             then v_new.brand_name := nullif(btrim(p ->> 'brand_name'), ''); end if;
  if p ? 'company_id'             then v_new.company_id := (p ->> 'company_id')::uuid; end if;
  if p ? 'category_id'            then v_new.category_id := (p ->> 'category_id')::uuid; end if;
  if p ? 'subcategory_id'         then v_new.subcategory_id := (p ->> 'subcategory_id')::uuid; end if;
  if p ? 'strength'               then v_new.strength := nullif(btrim(p ->> 'strength'), ''); end if;
  if p ? 'dosage_form'            then v_new.dosage_form := nullif(btrim(p ->> 'dosage_form'), ''); end if;
  if p ? 'unit'                   then v_new.unit := btrim(p ->> 'unit'); end if;
  if p ? 'pack_size'              then v_new.pack_size := (p ->> 'pack_size')::integer; end if;
  if p ? 'barcode'                then v_new.barcode := nullif(btrim(p ->> 'barcode'), ''); end if;
  if p ? 'sku'                    then v_new.sku := nullif(btrim(p ->> 'sku'), ''); end if;
  if p ? 'default_purchase_price' then v_new.default_purchase_price := (p ->> 'default_purchase_price')::numeric; end if;
  if p ? 'default_sale_price'     then v_new.default_sale_price := (p ->> 'default_sale_price')::numeric; end if;
  if p ? 'mrp'                    then v_new.mrp := (p ->> 'mrp')::numeric; end if;
  if p ? 'minimum_stock'          then v_new.minimum_stock := (p ->> 'minimum_stock')::integer; end if;
  if p ? 'reorder_level'          then v_new.reorder_level := (p ->> 'reorder_level')::integer; end if;
  if p ? 'prescription_required'  then v_new.prescription_required := (p ->> 'prescription_required')::boolean; end if;
  if p ? 'tax_rate'               then v_new.tax_rate := (p ->> 'tax_rate')::numeric; end if;
  if p ? 'description'            then v_new.description := nullif(btrim(p ->> 'description'), ''); end if;
  if p ? 'image_url'              then v_new.image_url := nullif(btrim(p ->> 'image_url'), ''); end if;
  if p ? 'is_active'              then v_new.is_active := (p ->> 'is_active')::boolean; end if;

  -- Setting or changing a price needs price.edit.
  if p_id is null then
    if (v_new.default_purchase_price is not null or v_new.default_sale_price is not null)
       and not public.has_permission_any('price.edit') then
      raise exception 'price.edit is required to set prices' using errcode = 'PH033';
    end if;
  elsif (v_new.default_purchase_price is distinct from v_old.default_purchase_price
         or v_new.default_sale_price is distinct from v_old.default_sale_price)
        and not public.has_permission_any('price.edit') then
    raise exception 'price.edit is required to change prices' using errcode = 'PH033';
  end if;

  if v_new.mrp is not null and v_new.default_sale_price is not null
     and v_new.default_sale_price > v_new.mrp then
    raise exception 'sale price % is above the MRP %', v_new.default_sale_price, v_new.mrp using errcode = 'PH031';
  end if;

  if v_new.subcategory_id is not null
     and not exists (select 1 from public.subcategories s
                      where s.id = v_new.subcategory_id and s.category_id = v_new.category_id) then
    raise exception 'subcategory does not belong to the category' using errcode = 'PH034';
  end if;

  if p_id is null then
    insert into public.medicines select v_new.*;
  else
    update public.medicines m set
      name = v_new.name, generic_name = v_new.generic_name, brand_name = v_new.brand_name,
      company_id = v_new.company_id, category_id = v_new.category_id, subcategory_id = v_new.subcategory_id,
      strength = v_new.strength, dosage_form = v_new.dosage_form, unit = v_new.unit,
      pack_size = v_new.pack_size, barcode = v_new.barcode, sku = v_new.sku,
      default_purchase_price = v_new.default_purchase_price, default_sale_price = v_new.default_sale_price,
      mrp = v_new.mrp, minimum_stock = v_new.minimum_stock, reorder_level = v_new.reorder_level,
      prescription_required = v_new.prescription_required, tax_rate = v_new.tax_rate,
      description = v_new.description, image_url = v_new.image_url, is_active = v_new.is_active
    where m.id = p_id;
  end if;

  return v_new.id;
end $$;

-- Cost is only for people who may see it.
create function public.medicine_default_cost(p_medicine uuid) returns numeric
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare v numeric;
begin
  perform public.require_permission_any('purchase.view_cost');
  select m.default_purchase_price into v from public.medicines m where m.id = p_medicine;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- Search and listing. One function serves the catalogue list, the POS search box
-- and barcode scans: exact barcode/SKU first, then name prefix, then contains.
-- ---------------------------------------------------------------------------
create function public.search_medicines(
  p_branch uuid,
  p_query text default '',
  p_limit integer default 25,
  p_offset integer default 0,
  p_include_inactive boolean default false
) returns table (
  id uuid,
  name text,
  generic_name text,
  brand_name text,
  company_id uuid,
  company_name text,
  category_id uuid,
  strength text,
  dosage_form text,
  unit text,
  pack_size integer,
  barcode text,
  sku text,
  default_sale_price numeric,
  mrp numeric,
  reorder_level integer,
  prescription_required boolean,
  is_active boolean,
  stock_on_hand integer,
  total_count bigint
)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_raw text := btrim(coalesce(p_query, ''));
  v_pat text;
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_today date;
  v_show_stock boolean;
begin
  perform public.require_permission(p_branch, 'medicine.view');
  v_show_stock := public.has_permission(p_branch, 'stock.view');
  v_today := public.branch_today(p_branch);
  -- Treat the query as plain text: escape LIKE wildcards.
  v_pat := replace(replace(replace(v_raw, '\', '\\'), '%', '\%'), '_', '\_');

  return query
  with page as (
    select m.*, c.name as company_name, count(*) over () as total_count
    from public.medicines m
    left join public.companies c on c.id = m.company_id
    where (p_include_inactive or m.is_active)
      and (
        v_raw = ''
        or m.barcode = v_raw
        or lower(m.sku) = lower(v_raw)
        or m.name ilike '%' || v_pat || '%'
        or m.generic_name ilike '%' || v_pat || '%'
        or m.brand_name ilike '%' || v_pat || '%'
        or c.name ilike '%' || v_pat || '%'
      )
    order by
      case
        when v_raw = '' then 1
        when m.barcode = v_raw or lower(m.sku) = lower(v_raw) then 0
        when m.name ilike v_pat || '%' then 1
        else 2
      end,
      lower(m.name), m.id
    limit v_limit offset v_offset
  )
  select
    pg.id, pg.name, pg.generic_name, pg.brand_name, pg.company_id, pg.company_name,
    pg.category_id, pg.strength, pg.dosage_form, pg.unit, pg.pack_size, pg.barcode, pg.sku,
    pg.default_sale_price, pg.mrp, pg.reorder_level, pg.prescription_required, pg.is_active,
    case when v_show_stock then (
      select coalesce(sum(b.quantity), 0)::integer
      from public.medicine_batches b
      where b.branch_id = p_branch and b.medicine_id = pg.id and b.expiry_date > v_today
    ) end,
    pg.total_count
  from page pg
  order by
    case
      when v_raw = '' then 1
      when pg.barcode = v_raw or lower(pg.sku) = lower(v_raw) then 0
      when pg.name ilike v_pat || '%' then 1
      else 2
    end,
    lower(pg.name), pg.id;
end $$;

-- ---------------------------------------------------------------------------
-- Batches
-- ---------------------------------------------------------------------------

-- FEFO order (earliest expiry first). Cost is returned only to purchase.view_cost.
create function public.list_batches(p_branch uuid, p_medicine uuid)
returns table (
  id uuid,
  batch_number text,
  expiry_date date,
  days_to_expiry integer,
  is_expired boolean,
  purchase_price numeric,
  sale_price numeric,
  mrp numeric,
  quantity integer,
  created_at timestamptz
)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_today date;
  v_cost boolean;
begin
  perform public.require_permission(p_branch, 'stock.view');
  v_today := public.branch_today(p_branch);
  v_cost := public.has_permission(p_branch, 'purchase.view_cost');

  return query
  select b.id, b.batch_number, b.expiry_date,
         (b.expiry_date - v_today)::integer,
         b.expiry_date <= v_today,
         case when v_cost then b.purchase_price end,
         b.sale_price, b.mrp, b.quantity, b.created_at
  from public.medicine_batches b
  where b.branch_id = p_branch and b.medicine_id = p_medicine
  order by b.expiry_date, b.created_at, b.id;
end $$;

-- Create a batch with its opening stock, atomically. Needs batch.edit and
-- stock.adjust in the branch. Purchases (Phase 7) will create batches too.
create function public.create_batch(p jsonb) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_allowed constant text[] := array[
    'branch_id','medicine_id','batch_number','expiry_date',
    'purchase_price','sale_price','mrp','quantity'];
  v_required constant text[] := array[
    'branch_id','medicine_id','batch_number','expiry_date','purchase_price','sale_price','quantity'];
  v_unknown text[];
  v_missing text[];
  v_branch uuid;
  v_medicine uuid;
  v_qty integer;
  v_expiry date;
  v_sale numeric;
  v_mrp numeric;
  v_id uuid := gen_random_uuid();
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'p must be a JSON object' using errcode = '22023';
  end if;
  select array_agg(k) into v_unknown from jsonb_object_keys(p) k where k <> all (v_allowed);
  if v_unknown is not null then
    raise exception 'unknown batch field(s): %', array_to_string(v_unknown, ', ') using errcode = '22023';
  end if;
  select array_agg(k) into v_missing from unnest(v_required) k
   where not (p ? k) or p -> k = 'null'::jsonb;
  if v_missing is not null then
    raise exception 'missing field(s): %', array_to_string(v_missing, ', ') using errcode = '22023';
  end if;

  v_branch := (p ->> 'branch_id')::uuid;
  v_medicine := (p ->> 'medicine_id')::uuid;
  perform public.require_permission(v_branch, 'batch.edit');
  perform public.require_permission(v_branch, 'stock.adjust');

  if not exists (select 1 from public.medicines m where m.id = v_medicine and m.is_active) then
    raise exception 'medicine not found or inactive' using errcode = 'P0002';
  end if;

  v_qty := (p ->> 'quantity')::integer;
  v_expiry := (p ->> 'expiry_date')::date;
  v_sale := (p ->> 'sale_price')::numeric;
  v_mrp := (p ->> 'mrp')::numeric;

  if v_qty <= 0 then
    raise exception 'opening quantity must be positive' using errcode = '23514';
  end if;
  -- Stock that cannot be sold is not added. A batch expiring today is expired.
  if v_expiry <= public.branch_today(v_branch) then
    raise exception 'expiry date must be after today' using errcode = 'PH030';
  end if;
  if v_mrp is not null and v_sale > v_mrp then
    raise exception 'sale price % is above the MRP %', v_sale, v_mrp using errcode = 'PH031';
  end if;

  insert into public.medicine_batches
    (id, branch_id, medicine_id, batch_number, expiry_date,
     purchase_price, sale_price, mrp, quantity, created_by)
  values
    (v_id, v_branch, v_medicine, btrim(p ->> 'batch_number'), v_expiry,
     (p ->> 'purchase_price')::numeric, v_sale, v_mrp, v_qty, auth.uid());

  insert into public.stock_movements
    (branch_id, medicine_id, batch_id, quantity_delta, movement_type,
     reference_type, reference_id, reason, user_id)
  values
    (v_branch, v_medicine, v_id, v_qty, 'OPENING_STOCK',
     'batch', v_id::text, 'Opening stock', auth.uid());

  return v_id;
end $$;

-- Price corrections on an existing batch. Cost is never edited: it is history.
create function public.update_batch_prices(p_batch uuid, p_sale_price numeric, p_mrp numeric)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_branch uuid;
begin
  select b.branch_id into v_branch from public.medicine_batches b where b.id = p_batch for update;
  if v_branch is null then
    raise exception 'batch not found' using errcode = 'P0002';
  end if;
  perform public.require_permission(v_branch, 'price.edit');

  if p_mrp is not null and p_sale_price > p_mrp then
    raise exception 'sale price % is above the MRP %', p_sale_price, p_mrp using errcode = 'PH031';
  end if;

  update public.medicine_batches set sale_price = p_sale_price, mrp = p_mrp where id = p_batch;
end $$;

-- ---------------------------------------------------------------------------
-- Privileges: callable by signed-in users only; each checks its own permission.
-- ---------------------------------------------------------------------------
revoke all on function public.save_company(uuid, text, boolean) from public;
revoke all on function public.save_category(uuid, text, boolean) from public;
revoke all on function public.save_subcategory(uuid, uuid, text, boolean) from public;
revoke all on function public.save_medicine(uuid, jsonb) from public;
revoke all on function public.medicine_default_cost(uuid) from public;
revoke all on function public.search_medicines(uuid, text, integer, integer, boolean) from public;
revoke all on function public.list_batches(uuid, uuid) from public;
revoke all on function public.create_batch(jsonb) from public;
revoke all on function public.update_batch_prices(uuid, numeric, numeric) from public;

grant execute on function public.save_company(uuid, text, boolean) to authenticated;
grant execute on function public.save_category(uuid, text, boolean) to authenticated;
grant execute on function public.save_subcategory(uuid, uuid, text, boolean) to authenticated;
grant execute on function public.save_medicine(uuid, jsonb) to authenticated;
grant execute on function public.medicine_default_cost(uuid) to authenticated;
grant execute on function public.search_medicines(uuid, text, integer, integer, boolean) to authenticated;
grant execute on function public.list_batches(uuid, uuid) to authenticated;
grant execute on function public.create_batch(jsonb) to authenticated;
grant execute on function public.update_batch_prices(uuid, numeric, numeric) to authenticated;
