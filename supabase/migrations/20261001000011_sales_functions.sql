-- Phase 5 / 2 of 3: the point-of-sale functions.
--
-- sale_plan is the ONE place that prices a cart and chooses batches (FEFO). Both the
-- cart quote and the sale itself call it, so what the cashier sees is what is sold and
-- the browser never does financial arithmetic. complete_sale then writes everything in
-- one transaction.
--
-- Money rules (see docs/PHARMACY_WORKFLOWS.md):
--   * prices are per unit with up to 4 decimals; a line's gross is rounded half-up to
--     2 decimals once; discounts are taken off that; amounts have at most 2 decimals
--   * prices are VAT-inclusive: tax = net x rate / (100 + rate), rounded to 2 decimals
--   * profit = (net - tax) - the cost of the batches actually sold

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------
create function public.customer_balance(p_branch uuid, p_customer uuid) returns numeric
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_permission(p_branch, 'customer.view');
  return coalesce((select sum(l.amount) from public.customer_ledger_entries l
                    where l.customer_id = p_customer and l.branch_id = p_branch), 0);
end $$;

create function public.save_customer(p jsonb) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_allowed constant text[] := array['id','branch_id','name','phone','address','credit_limit','is_active'];
  v_unknown text[];
  v_branch uuid;
  v_id uuid;
  v_limit numeric;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'p must be a JSON object' using errcode = '22023';
  end if;
  select array_agg(k) into v_unknown from jsonb_object_keys(p) k where k <> all (v_allowed);
  if v_unknown is not null then
    raise exception 'unknown field(s): %', array_to_string(v_unknown, ', ') using errcode = '22023';
  end if;

  v_branch := (p ->> 'branch_id')::uuid;
  perform public.require_permission(v_branch, 'customer.edit');
  v_id := (p ->> 'id')::uuid;

  if p ? 'credit_limit' then
    v_limit := (p ->> 'credit_limit')::numeric;
    if v_limit is not null and v_limit <> round(v_limit, 2) then
      raise exception 'credit limit has at most 2 decimals' using errcode = '22023';
    end if;
  end if;

  if v_id is null then
    if not (p ? 'name') then raise exception 'name is required' using errcode = '22023'; end if;
    insert into public.customers (branch_id, name, phone, address, credit_limit, is_active, created_by)
    values (v_branch, btrim(p ->> 'name'), nullif(btrim(p ->> 'phone'), ''), nullif(btrim(p ->> 'address'), ''),
            v_limit, coalesce((p ->> 'is_active')::boolean, true), auth.uid())
    returning id into v_id;
  else
    update public.customers c set
      name = case when p ? 'name' then btrim(p ->> 'name') else c.name end,
      phone = case when p ? 'phone' then nullif(btrim(p ->> 'phone'), '') else c.phone end,
      address = case when p ? 'address' then nullif(btrim(p ->> 'address'), '') else c.address end,
      credit_limit = case when p ? 'credit_limit' then v_limit else c.credit_limit end,
      is_active = case when p ? 'is_active' then (p ->> 'is_active')::boolean else c.is_active end
    where c.id = v_id and c.branch_id = v_branch;
    if not found then raise exception 'customer not found' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;

create function public.search_customers(p_branch uuid, p_query text default '', p_limit integer default 10)
returns table (id uuid, name text, phone text, address text, credit_limit numeric, balance numeric)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_pat text := replace(replace(replace(btrim(coalesce(p_query, '')), '\', '\\'), '%', '\%'), '_', '\_');
  v_limit integer := least(greatest(coalesce(p_limit, 10), 1), 50);
begin
  perform public.require_permission(p_branch, 'customer.view');
  return query
  select c.id, c.name, c.phone, c.address, c.credit_limit,
         coalesce((select sum(l.amount) from public.customer_ledger_entries l
                    where l.customer_id = c.id and l.branch_id = c.branch_id), 0)
  from public.customers c
  where c.branch_id = p_branch and c.is_active
    and (v_pat = '' or c.name ilike '%' || v_pat || '%' or c.phone ilike '%' || v_pat || '%')
  order by lower(c.name), c.id
  limit v_limit;
end $$;

-- ---------------------------------------------------------------------------
-- POS lookups
-- ---------------------------------------------------------------------------

-- Search for the till: name/generic/brand/company/barcode/SKU. Shows the price of the
-- batch that would be sold first (FEFO) and what is sellable. exact_match marks a
-- barcode or SKU hit, so a scanner can add the item without a click.
create function public.pos_search(p_branch uuid, p_query text default '', p_limit integer default 20)
returns table (
  id uuid, name text, generic_name text, strength text, dosage_form text, unit text,
  company_name text, barcode text, sku text, prescription_required boolean,
  sale_price numeric, mrp numeric, sellable_qty integer, batch_count integer,
  nearest_expiry date, exact_match boolean
)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_raw text := btrim(coalesce(p_query, ''));
  v_pat text := replace(replace(replace(btrim(coalesce(p_query, '')), '\', '\\'), '%', '\%'), '_', '\_');
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_today date;
begin
  perform public.require_permission(p_branch, 'sale.create');
  v_today := public.branch_today(p_branch);

  return query
  with hits as (
    select m.*, c.name as company_name,
           (v_raw <> '' and (m.barcode = v_raw or lower(m.sku) = lower(v_raw))) as is_exact
    from public.medicines m
    left join public.companies c on c.id = m.company_id
    where m.is_active
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
      (v_raw <> '' and (m.barcode = v_raw or lower(m.sku) = lower(v_raw))) desc,
      (m.name ilike v_pat || '%') desc,
      lower(m.name), m.id
    limit v_limit
  )
  select h.id, h.name, h.generic_name, h.strength, h.dosage_form, h.unit,
         h.company_name, h.barcode, h.sku, h.prescription_required,
         first_batch.sale_price,
         coalesce(first_batch.mrp, h.mrp),
         coalesce(stock.qty, 0)::integer,
         coalesce(stock.batches, 0)::integer,
         first_batch.expiry_date,
         h.is_exact
  from hits h
  left join lateral (
    select b.sale_price, b.mrp, b.expiry_date
    from public.medicine_batches b
    where b.branch_id = p_branch and b.medicine_id = h.id and b.quantity > 0 and b.expiry_date > v_today
    order by b.expiry_date, b.created_at, b.id
    limit 1
  ) first_batch on true
  left join lateral (
    select sum(b.quantity) as qty, count(*) as batches
    from public.medicine_batches b
    where b.branch_id = p_branch and b.medicine_id = h.id and b.quantity > 0 and b.expiry_date > v_today
  ) stock on true
  order by h.is_exact desc, (h.name ilike v_pat || '%') desc, lower(h.name), h.id;
end $$;

-- Sellable batches of one medicine, in FEFO order, for the batch picker.
create function public.pos_batches(p_branch uuid, p_medicine uuid)
returns table (id uuid, batch_number text, expiry_date date, days_to_expiry integer,
               quantity integer, sale_price numeric, mrp numeric)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare v_today date;
begin
  perform public.require_permission(p_branch, 'sale.create');
  v_today := public.branch_today(p_branch);
  return query
  select b.id, b.batch_number, b.expiry_date, (b.expiry_date - v_today)::integer,
         b.quantity, b.sale_price, b.mrp
  from public.medicine_batches b
  where b.branch_id = p_branch and b.medicine_id = p_medicine
    and b.quantity > 0 and b.expiry_date > v_today
  order by b.expiry_date, b.created_at, b.id;
end $$;

-- ---------------------------------------------------------------------------
-- The planner: prices a cart and picks batches. Internal; not callable by clients.
--
-- items: [{medicine_id, quantity, discount_type: NONE|AMOUNT|PERCENT, discount_value,
--          batch_id (optional: sell from exactly this batch)}]
-- p_lock = true locks the chosen batches (FOR UPDATE) for the real sale; false is a
-- dry run for the quote. Lines for the same medicine see each other's allocations.
-- Money in the result is text, so no consumer ever sees a float.
-- ---------------------------------------------------------------------------
create function public.sale_plan(p_branch uuid, p_items jsonb, p_lock boolean) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_allowed constant text[] := array['medicine_id','quantity','discount_type','discount_value','batch_id'];
  v_today date := public.branch_today(p_branch);
  v_max_pct numeric;
  v_can_discount boolean := public.has_permission(p_branch, 'sale.discount');
  v_can_rx boolean := public.has_permission(p_branch, 'sale.dispense_rx');
  v_remaining jsonb := '{}'::jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_unknown text[];
  v_lock text := case when p_lock then 'for update' else '' end;
  v_idx integer := 0;
  v_item jsonb;
  v_med public.medicines%rowtype;
  v_b record;
  v_qty integer;
  v_need integer;
  v_take integer;
  v_avail integer;
  v_explicit uuid;
  v_allocs jsonb;
  v_gross_raw numeric;
  v_gross numeric;
  v_cost numeric;
  v_dtype text;
  v_dvalue numeric;
  v_disc numeric;
  v_net numeric;
  v_tax numeric;
  v_profit numeric;
  t_sub numeric := 0;
  t_disc numeric := 0;
  t_tax numeric := 0;
  t_grand numeric := 0;
  t_cost numeric := 0;
  t_profit numeric := 0;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'the cart is empty' using errcode = 'PH057';
  end if;
  if jsonb_array_length(p_items) > 100 then
    raise exception 'a sale can have at most 100 lines' using errcode = '22023';
  end if;
  select coalesce((b.settings ->> 'max_discount_percent')::numeric, 5) into v_max_pct
    from public.branches b where b.id = p_branch;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_idx := v_idx + 1;
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'line % is not an object', v_idx using errcode = '22023';
    end if;
    select array_agg(k) into v_unknown from jsonb_object_keys(v_item) k where k <> all (v_allowed);
    if v_unknown is not null then
      raise exception 'unknown line field(s): %', array_to_string(v_unknown, ', ') using errcode = '22023';
    end if;

    select * into v_med from public.medicines m
     where m.id = (v_item ->> 'medicine_id')::uuid and m.is_active;
    if not found then
      raise exception 'medicine on line % was not found or is retired', v_idx using errcode = 'P0002';
    end if;

    v_qty := (v_item ->> 'quantity')::integer;
    if v_qty is null or v_qty < 1 or v_qty > 100000 then
      raise exception 'quantity on line % must be between 1 and 100000', v_idx using errcode = '22023';
    end if;

    v_explicit := (v_item ->> 'batch_id')::uuid;
    v_allocs := '[]'::jsonb;
    v_need := v_qty;
    v_gross_raw := 0;
    v_cost := 0;

    if v_explicit is not null then
      -- The cashier chose one batch: sell from it or fail. No silent spill-over.
      execute format('select * from public.medicine_batches
                       where id = $1 and branch_id = $2 and medicine_id = $3 %s', v_lock)
        into v_b using v_explicit, p_branch, v_med.id;
      if v_b.id is null or v_b.expiry_date <= v_today then
        raise exception 'that batch cannot be sold' using errcode = 'PH044',
          hint = jsonb_build_object('line', v_idx, 'medicine_id', v_med.id)::text;
      end if;
      v_avail := coalesce((v_remaining ->> v_b.id::text)::integer, v_b.quantity);
      if v_avail < v_qty then
        raise exception 'not enough stock in the chosen batch' using errcode = 'PH001',
          hint = jsonb_build_object('line', v_idx, 'medicine_id', v_med.id, 'available', greatest(v_avail, 0))::text;
      end if;
      v_allocs := v_allocs || jsonb_build_array(jsonb_build_object(
        'batch_id', v_b.id, 'batch_number', v_b.batch_number, 'expiry_date', v_b.expiry_date,
        'quantity', v_qty, 'unit_price', v_b.sale_price::text, 'unit_cost', v_b.purchase_price::text));
      v_remaining := jsonb_set(v_remaining, array[v_b.id::text], to_jsonb(v_avail - v_qty));
      v_gross_raw := v_qty * v_b.sale_price;
      v_cost := v_qty * v_b.purchase_price;
      v_need := 0;
    else
      -- FEFO: earliest expiry first, expired batches never considered.
      for v_b in execute format(
        'select * from public.medicine_batches
          where branch_id = $1 and medicine_id = $2 and quantity > 0 and expiry_date > $3
          order by expiry_date, created_at, id %s', v_lock)
        using p_branch, v_med.id, v_today
      loop
        v_avail := coalesce((v_remaining ->> v_b.id::text)::integer, v_b.quantity);
        continue when v_avail <= 0;
        v_take := least(v_avail, v_need);
        v_allocs := v_allocs || jsonb_build_array(jsonb_build_object(
          'batch_id', v_b.id, 'batch_number', v_b.batch_number, 'expiry_date', v_b.expiry_date,
          'quantity', v_take, 'unit_price', v_b.sale_price::text, 'unit_cost', v_b.purchase_price::text));
        v_remaining := jsonb_set(v_remaining, array[v_b.id::text], to_jsonb(v_avail - v_take));
        v_gross_raw := v_gross_raw + v_take * v_b.sale_price;
        v_cost := v_cost + v_take * v_b.purchase_price;
        v_need := v_need - v_take;
        exit when v_need = 0;
      end loop;
      if v_need > 0 then
        raise exception 'not enough sellable stock' using errcode = 'PH001',
          hint = jsonb_build_object('line', v_idx, 'medicine_id', v_med.id, 'available', v_qty - v_need)::text;
      end if;
    end if;

    -- Round once, half up, then everything else works from the rounded gross.
    v_gross := round(v_gross_raw, 2);

    v_dtype := upper(coalesce(nullif(v_item ->> 'discount_type', ''), 'NONE'));
    v_dvalue := nullif(v_item ->> 'discount_value', '')::numeric;
    if v_dtype = 'NONE' then
      v_disc := 0;
    elsif v_dtype = 'PERCENT' then
      if v_dvalue is null or v_dvalue < 0 or v_dvalue > 100 or v_dvalue <> round(v_dvalue, 2) then
        raise exception 'discount percent on line % must be 0 to 100 with at most 2 decimals', v_idx using errcode = 'PH050';
      end if;
      v_disc := round(v_gross * v_dvalue / 100, 2);
    elsif v_dtype = 'AMOUNT' then
      if v_dvalue is null or v_dvalue < 0 or v_dvalue <> round(v_dvalue, 2) or v_dvalue > v_gross then
        raise exception 'discount on line % must be between 0 and the line total', v_idx using errcode = 'PH050';
      end if;
      v_disc := v_dvalue;
    else
      raise exception 'unknown discount_type %', v_dtype using errcode = '22023';
    end if;

    v_net := v_gross - v_disc;
    v_tax := case when v_med.tax_rate > 0 then round(v_net * v_med.tax_rate / (100 + v_med.tax_rate), 2) else 0 end;
    v_profit := (v_net - v_tax) - v_cost;

    -- Rules that need a permission beyond selling.
    if v_disc > 0 and not v_can_discount and v_disc * 100 > v_gross * v_max_pct then
      raise exception 'discount on line % is above the allowed % percent', v_idx, v_max_pct using errcode = 'PH052',
        hint = jsonb_build_object('line', v_idx, 'medicine_id', v_med.id, 'max_percent', v_max_pct)::text;
    end if;
    if not v_can_discount and (v_net - v_tax) < v_cost then
      raise exception 'line % would sell below cost', v_idx using errcode = 'PH053',
        hint = jsonb_build_object('line', v_idx, 'medicine_id', v_med.id)::text;
    end if;
    if v_med.prescription_required and not v_can_rx then
      raise exception 'line % needs a pharmacist (prescription medicine)', v_idx using errcode = 'PH054',
        hint = jsonb_build_object('line', v_idx, 'medicine_id', v_med.id)::text;
    end if;

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'line_no', v_idx,
      'medicine_id', v_med.id,
      'name', v_med.name,
      'strength', v_med.strength,
      'unit', v_med.unit,
      'quantity', v_qty,
      'prescription_required', v_med.prescription_required,
      'tax_rate', v_med.tax_rate::text,
      'gross', v_gross::text,
      'discount', v_disc::text,
      'tax_amount', v_tax::text,
      'line_total', v_net::text,
      'cost_total', v_cost::text,
      'profit', v_profit::text,
      'allocations', v_allocs));

    t_sub := t_sub + v_gross;
    t_disc := t_disc + v_disc;
    t_tax := t_tax + v_tax;
    t_grand := t_grand + v_net;
    t_cost := t_cost + v_cost;
    t_profit := t_profit + v_profit;
  end loop;

  return jsonb_build_object(
    'lines', v_lines,
    'totals', jsonb_build_object(
      'subtotal', t_sub::text, 'discount_total', t_disc::text, 'tax_total', t_tax::text,
      'grand_total', t_grand::text, 'cost_total', t_cost::text, 'profit_total', t_profit::text));
end $$;

-- A price check for the cart: same planner, nothing written, nothing locked.
-- Cost and profit are included only for people allowed to see them.
create function public.quote_sale(p_branch uuid, p_items jsonb) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_plan jsonb;
  v_cost boolean;
  v_profit boolean;
  v_lines jsonb := '[]'::jsonb;
  l jsonb;
  v_allocs jsonb;
  a jsonb;
  v_totals jsonb;
begin
  perform public.require_permission(p_branch, 'sale.create');
  v_plan := public.sale_plan(p_branch, p_items, false);
  v_cost := public.has_permission(p_branch, 'purchase.view_cost');
  v_profit := public.has_permission(p_branch, 'finance.view_profit');

  for l in select value from jsonb_array_elements(v_plan -> 'lines') loop
    v_allocs := '[]'::jsonb;
    for a in select value from jsonb_array_elements(l -> 'allocations') loop
      v_allocs := v_allocs || jsonb_build_array(a - 'unit_cost');
    end loop;
    l := jsonb_set(l, '{allocations}', v_allocs);
    l := l - 'cost_total' - 'profit';
    if v_cost then
      l := l || jsonb_build_object('cost_total', (select x ->> 'cost_total' from jsonb_array_elements(v_plan -> 'lines') x where (x ->> 'line_no') = (l ->> 'line_no')));
    end if;
    if v_profit then
      l := l || jsonb_build_object('profit', (select x ->> 'profit' from jsonb_array_elements(v_plan -> 'lines') x where (x ->> 'line_no') = (l ->> 'line_no')));
    end if;
    v_lines := v_lines || jsonb_build_array(l);
  end loop;

  v_totals := v_plan -> 'totals';
  if not v_cost then v_totals := v_totals - 'cost_total'; end if;
  if not v_profit then v_totals := v_totals - 'profit_total'; end if;
  return jsonb_build_object('lines', v_lines, 'totals', v_totals);
end $$;

-- ---------------------------------------------------------------------------
-- Invoice document (customer-facing: no cost, no profit)
-- ---------------------------------------------------------------------------
create function public.build_invoice(p_sale uuid) returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  s public.sales%rowtype;
  v_items jsonb;
  v_payments jsonb;
  v_customer jsonb;
  v_branch jsonb;
begin
  select * into s from public.sales where id = p_sale;
  if not found then raise exception 'sale not found' using errcode = 'P0002'; end if;

  select jsonb_build_object(
           'name', b.name, 'address', b.address, 'phone', b.phone, 'currency', b.currency,
           'invoice_footer', b.settings ->> 'invoice_footer',
           'vat_registration', b.settings ->> 'vat_registration')
    into v_branch from public.branches b where b.id = s.branch_id;

  select case when c.id is null then null else jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone) end
    into v_customer from public.customers c where c.id = s.customer_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'line_no', i.line_no, 'name', i.medicine_name, 'strength', i.strength, 'unit', i.unit,
           'quantity', i.quantity,
           'unit_price', case when i.quantity > 0 then round(i.gross / i.quantity, 4)::text end,
           'gross', i.gross::text, 'discount', i.discount::text,
           'tax_rate', i.tax_rate::text, 'tax_amount', i.tax_amount::text, 'line_total', i.line_total::text,
           'batches', (select coalesce(jsonb_agg(jsonb_build_object(
                         'batch_number', a.batch_number, 'expiry_date', a.expiry_date,
                         'quantity', a.quantity, 'unit_price', a.unit_price::text)
                         order by a.expiry_date, a.batch_number), '[]'::jsonb)
                       from public.sale_item_allocations a where a.sale_item_id = i.id))
         order by i.line_no), '[]'::jsonb)
    into v_items from public.sale_items i where i.sale_id = s.id;

  select coalesce(jsonb_agg(jsonb_build_object('method', p.method, 'amount', p.amount::text, 'reference', p.reference)
                            order by p.id), '[]'::jsonb)
    into v_payments from public.payments p where p.sale_id = s.id;

  return jsonb_build_object(
    'id', s.id,
    'invoice_no', s.invoice_no,
    'sold_at', s.sold_at,
    'status', s.status,
    'branch', v_branch,
    'customer', v_customer,
    'cashier', (select nullif(btrim(p.full_name), '') from public.profiles p where p.id = s.created_by),
    'notes', s.notes,
    'items', v_items,
    'payments', v_payments,
    'totals', jsonb_build_object(
      'subtotal', s.subtotal::text, 'discount_total', s.discount_total::text, 'tax_total', s.tax_total::text,
      'grand_total', s.grand_total::text, 'paid_total', s.paid_total::text, 'due_total', s.due_total::text));
end $$;

create function public.get_invoice(p_sale uuid) returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare s record;
begin
  select branch_id, created_by into s from public.sales where id = p_sale;
  if not found then raise exception 'sale not found' using errcode = 'P0002'; end if;
  if not (public.has_permission(s.branch_id, 'sale.view_all')
          or (s.created_by = auth.uid() and public.has_permission(s.branch_id, 'sale.create'))) then
    raise exception 'permission denied: sale.view_all' using errcode = '42501';
  end if;
  return public.build_invoice(p_sale);
end $$;

-- ---------------------------------------------------------------------------
-- Completing a sale
--
-- p: {branch_id, client_request_id, customer_id?, notes?,
--     items: [...as for quote_sale...],
--     payments: [{method: CASH|BKASH|NAGAD|ROCKET|CARD|BANK|CREDIT, amount, reference?}]}
-- Money methods plus CREDIT must add up to the grand total EXACTLY. CREDIT becomes the
-- sale's due amount and a ledger entry; it needs a customer and respects their limit.
-- Everything below happens in one transaction: if any step fails, nothing is written.
-- A repeated client_request_id returns the original invoice.
-- ---------------------------------------------------------------------------
create function public.complete_sale(p jsonb) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_allowed constant text[] := array['branch_id','client_request_id','customer_id','notes','items','payments'];
  v_unknown text[];
  v_branch uuid;
  v_request uuid;
  v_customer uuid;
  v_cust public.customers%rowtype;
  v_notes text;
  v_existing uuid;
  v_plan jsonb;
  v_grand numeric;
  v_paid numeric := 0;
  v_credit numeric := 0;
  v_pay jsonb;
  v_method text;
  v_amount numeric;
  v_ref text;
  v_money jsonb := '[]'::jsonb;
  v_seq bigint;
  v_prefix text;
  v_sale uuid := gen_random_uuid();
  v_line jsonb;
  v_alloc jsonb;
  v_item uuid;
  v_take integer;
  v_balance numeric;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'p must be a JSON object' using errcode = '22023';
  end if;
  select array_agg(k) into v_unknown from jsonb_object_keys(p) k where k <> all (v_allowed);
  if v_unknown is not null then
    raise exception 'unknown field(s): %', array_to_string(v_unknown, ', ') using errcode = '22023';
  end if;
  if p -> 'branch_id' is null or p -> 'client_request_id' is null then
    raise exception 'branch_id and client_request_id are required' using errcode = '22023';
  end if;

  v_branch := (p ->> 'branch_id')::uuid;
  v_request := (p ->> 'client_request_id')::uuid;
  v_customer := (p ->> 'customer_id')::uuid;
  v_notes := nullif(btrim(p ->> 'notes'), '');
  perform public.require_permission(v_branch, 'sale.create');

  -- Same request twice (double click, retry, two tabs): one sale. The advisory lock makes
  -- the second caller wait for the first to commit, then return its invoice.
  perform pg_advisory_xact_lock(hashtextextended(v_branch::text || ':' || v_request::text, 0));
  select s.id into v_existing from public.sales s
   where s.branch_id = v_branch and s.client_request_id = v_request;
  if v_existing is not null then
    return public.build_invoice(v_existing);
  end if;

  if v_customer is not null then
    select * into v_cust from public.customers c
     where c.id = v_customer and c.branch_id = v_branch and c.is_active;
    if not found then raise exception 'customer not found' using errcode = 'P0002'; end if;
  end if;

  -- Price the cart and choose the batches, locking them.
  v_plan := public.sale_plan(v_branch, p -> 'items', true);
  v_grand := (v_plan -> 'totals' ->> 'grand_total')::numeric;

  -- Payments: validate each, then they must add up exactly.
  if p ? 'payments' and p -> 'payments' <> 'null'::jsonb then
    if jsonb_typeof(p -> 'payments') <> 'array' or jsonb_array_length(p -> 'payments') > 12 then
      raise exception 'payments must be a list of at most 12' using errcode = '22023';
    end if;
    for v_pay in select value from jsonb_array_elements(p -> 'payments') loop
      if jsonb_typeof(v_pay) <> 'object' then
        raise exception 'each payment must be an object' using errcode = '22023';
      end if;
      v_method := upper(btrim(v_pay ->> 'method'));
      v_amount := (v_pay ->> 'amount')::numeric;
      v_ref := nullif(btrim(v_pay ->> 'reference'), '');
      if v_method is null or v_method not in ('CASH','BKASH','NAGAD','ROCKET','CARD','BANK','CREDIT') then
        raise exception 'unknown payment method %', v_method using errcode = '22023';
      end if;
      if v_amount is null or v_amount <= 0 or v_amount <> round(v_amount, 2) then
        raise exception 'payment amounts must be above 0 with at most 2 decimals' using errcode = '22023';
      end if;
      if v_method = 'CREDIT' then
        v_credit := v_credit + v_amount;
      else
        v_paid := v_paid + v_amount;
        v_money := v_money || jsonb_build_array(jsonb_build_object('method', v_method, 'amount', v_amount, 'reference', v_ref));
      end if;
    end loop;
  end if;

  if v_paid + v_credit <> v_grand then
    raise exception 'payments % do not match the total %', v_paid + v_credit, v_grand using errcode = 'PH051',
      hint = jsonb_build_object('total', v_grand::text, 'received', (v_paid + v_credit)::text)::text;
  end if;

  if v_credit > 0 then
    if v_customer is null then
      raise exception 'credit needs a registered customer' using errcode = 'PH055';
    end if;
    if v_cust.credit_limit is not null then
      select coalesce(sum(l.amount), 0) into v_balance
        from public.customer_ledger_entries l where l.customer_id = v_customer and l.branch_id = v_branch;
      if v_balance + v_credit > v_cust.credit_limit then
        raise exception 'credit limit exceeded' using errcode = 'PH056',
          hint = jsonb_build_object('limit', v_cust.credit_limit::text, 'owed', v_balance::text, 'new_due', v_credit::text)::text;
      end if;
    end if;
  end if;

  -- Invoice number: one counter per branch, serialised by the row lock.
  insert into public.invoice_counters (branch_id, last_seq) values (v_branch, 1)
  on conflict (branch_id) do update set last_seq = public.invoice_counters.last_seq + 1
  returning last_seq into v_seq;
  select coalesce(nullif(btrim(b.settings ->> 'invoice_prefix'), ''), 'INV') into v_prefix
    from public.branches b where b.id = v_branch;

  insert into public.sales
    (id, branch_id, invoice_seq, invoice_no, customer_id, subtotal, discount_total, tax_total,
     grand_total, paid_total, due_total, cost_total, profit_total, notes, client_request_id, created_by)
  values
    (v_sale, v_branch, v_seq, v_prefix || '-' || lpad(v_seq::text, 6, '0'), v_customer,
     (v_plan -> 'totals' ->> 'subtotal')::numeric,
     (v_plan -> 'totals' ->> 'discount_total')::numeric,
     (v_plan -> 'totals' ->> 'tax_total')::numeric,
     v_grand, v_paid, v_credit,
     (v_plan -> 'totals' ->> 'cost_total')::numeric,
     (v_plan -> 'totals' ->> 'profit_total')::numeric,
     v_notes, v_request, auth.uid());

  for v_line in select value from jsonb_array_elements(v_plan -> 'lines') loop
    insert into public.sale_items
      (sale_id, line_no, medicine_id, medicine_name, strength, unit, quantity, gross, discount,
       tax_rate, tax_amount, line_total, cost_total, profit)
    values
      (v_sale, (v_line ->> 'line_no')::integer, (v_line ->> 'medicine_id')::uuid, v_line ->> 'name',
       v_line ->> 'strength', v_line ->> 'unit', (v_line ->> 'quantity')::integer,
       (v_line ->> 'gross')::numeric, (v_line ->> 'discount')::numeric,
       (v_line ->> 'tax_rate')::numeric, (v_line ->> 'tax_amount')::numeric,
       (v_line ->> 'line_total')::numeric, (v_line ->> 'cost_total')::numeric, (v_line ->> 'profit')::numeric)
    returning id into v_item;

    for v_alloc in select value from jsonb_array_elements(v_line -> 'allocations') loop
      v_take := (v_alloc ->> 'quantity')::integer;
      insert into public.sale_item_allocations
        (sale_item_id, batch_id, batch_number, expiry_date, quantity, unit_price, unit_cost)
      values
        (v_item, (v_alloc ->> 'batch_id')::uuid, v_alloc ->> 'batch_number', (v_alloc ->> 'expiry_date')::date,
         v_take, (v_alloc ->> 'unit_price')::numeric, (v_alloc ->> 'unit_cost')::numeric);

      update public.medicine_batches set quantity = quantity - v_take
       where id = (v_alloc ->> 'batch_id')::uuid;

      insert into public.stock_movements
        (branch_id, medicine_id, batch_id, quantity_delta, movement_type, reference_type, reference_id, user_id)
      values
        (v_branch, (v_line ->> 'medicine_id')::uuid, (v_alloc ->> 'batch_id')::uuid, -v_take,
         'SALE', 'sale', v_sale::text, auth.uid());
    end loop;
  end loop;

  for v_pay in select value from jsonb_array_elements(v_money) loop
    insert into public.payments (branch_id, direction, method, amount, sale_id, customer_id, reference)
    values (v_branch, 'IN', v_pay ->> 'method', (v_pay ->> 'amount')::numeric, v_sale, v_customer, v_pay ->> 'reference');
  end loop;

  if v_credit > 0 then
    insert into public.customer_ledger_entries (branch_id, customer_id, entry_type, amount, sale_id, note)
    values (v_branch, v_customer, 'SALE_DUE', v_credit, v_sale, 'Sale on credit');
  end if;

  perform public.write_audit(v_branch, 'sale.complete', 'sales', v_sale::text, null,
    jsonb_build_object('invoice_no', v_prefix || '-' || lpad(v_seq::text, 6, '0'),
                       'grand_total', v_grand::text, 'paid_total', v_paid::text, 'due_total', v_credit::text,
                       'customer_id', v_customer, 'lines', jsonb_array_length(v_plan -> 'lines')));

  return public.build_invoice(v_sale);
end $$;

-- ---------------------------------------------------------------------------
-- Sale history. Cashiers see their own sales; sale.view_all sees everyone's.
-- Cost and profit appear only for purchase.view_cost / finance.view_profit.
-- ---------------------------------------------------------------------------
create function public.list_sales(
  p_branch uuid,
  p_query text default '',
  p_from date default null,
  p_to date default null,
  p_before_seq bigint default null,
  p_limit integer default 25
) returns table (
  sale_id uuid, invoice_no text, invoice_seq bigint, sold_at timestamptz,
  customer_id uuid, customer_name text, item_count integer,
  grand_total numeric, paid_total numeric, due_total numeric,
  cashier_name text, cost_total numeric, profit_total numeric
)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_all boolean := public.has_permission(p_branch, 'sale.view_all');
  v_own boolean := public.has_permission(p_branch, 'sale.create');
  v_cost boolean := public.has_permission(p_branch, 'purchase.view_cost');
  v_profit boolean := public.has_permission(p_branch, 'finance.view_profit');
  v_pat text := replace(replace(replace(btrim(coalesce(p_query, '')), '\', '\\'), '%', '\%'), '_', '\_');
  v_tz text;
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 101);
begin
  if not (v_all or v_own) then
    raise exception 'permission denied: sale.create' using errcode = '42501';
  end if;
  select b.timezone into v_tz from public.branches b where b.id = p_branch;

  return query
  select s.id, s.invoice_no, s.invoice_seq, s.sold_at, s.customer_id, c.name,
         (select count(*)::integer from public.sale_items i where i.sale_id = s.id),
         s.grand_total, s.paid_total, s.due_total,
         nullif(btrim(pr.full_name), ''),
         case when v_cost then s.cost_total end,
         case when v_profit then s.profit_total end
  from public.sales s
  left join public.customers c on c.id = s.customer_id
  left join public.profiles pr on pr.id = s.created_by
  where s.branch_id = p_branch
    and (v_all or s.created_by = auth.uid())
    and (p_before_seq is null or s.invoice_seq < p_before_seq)
    and (p_from is null or (s.sold_at at time zone v_tz)::date >= p_from)
    and (p_to is null or (s.sold_at at time zone v_tz)::date <= p_to)
    and (v_pat = '' or s.invoice_no ilike '%' || v_pat || '%'
         or c.name ilike '%' || v_pat || '%' or c.phone ilike '%' || v_pat || '%')
  order by s.invoice_seq desc
  limit v_limit;
end $$;

-- ---------------------------------------------------------------------------
-- Draft carts (own drafts only)
-- ---------------------------------------------------------------------------
create function public.save_sale_draft(p jsonb) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_allowed constant text[] := array['id','branch_id','name','customer_id','items'];
  v_line_allowed constant text[] := array['medicine_id','quantity','discount_type','discount_value','batch_id'];
  v_unknown text[];
  v_branch uuid;
  v_id uuid;
  v_item jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'p must be a JSON object' using errcode = '22023';
  end if;
  select array_agg(k) into v_unknown from jsonb_object_keys(p) k where k <> all (v_allowed);
  if v_unknown is not null then
    raise exception 'unknown field(s): %', array_to_string(v_unknown, ', ') using errcode = '22023';
  end if;
  if p -> 'items' is null or jsonb_typeof(p -> 'items') <> 'array'
     or jsonb_array_length(p -> 'items') = 0 or jsonb_array_length(p -> 'items') > 100 then
    raise exception 'a draft needs 1 to 100 lines' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(p -> 'items') loop
    select array_agg(k) into v_unknown from jsonb_object_keys(v_item) k where k <> all (v_line_allowed);
    if v_unknown is not null then
      raise exception 'unknown line field(s): %', array_to_string(v_unknown, ', ') using errcode = '22023';
    end if;
  end loop;

  v_branch := (p ->> 'branch_id')::uuid;
  perform public.require_permission(v_branch, 'sale.create');
  v_id := (p ->> 'id')::uuid;

  if v_id is null then
    if (select count(*) from public.sale_drafts d where d.branch_id = v_branch and d.created_by = auth.uid()) >= 50 then
      raise exception 'too many saved carts; delete some first' using errcode = '22023';
    end if;
    insert into public.sale_drafts (branch_id, created_by, name, customer_id, cart)
    values (v_branch, auth.uid(), nullif(btrim(p ->> 'name'), ''), (p ->> 'customer_id')::uuid, p -> 'items')
    returning id into v_id;
  else
    update public.sale_drafts d set
      name = nullif(btrim(p ->> 'name'), ''), customer_id = (p ->> 'customer_id')::uuid, cart = p -> 'items'
    where d.id = v_id and d.branch_id = v_branch and d.created_by = auth.uid();
    if not found then raise exception 'saved cart not found' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;

create function public.delete_sale_draft(p_draft uuid) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_branch uuid;
begin
  select d.branch_id into v_branch from public.sale_drafts d where d.id = p_draft and d.created_by = auth.uid();
  if v_branch is null then raise exception 'saved cart not found' using errcode = 'P0002'; end if;
  perform public.require_permission(v_branch, 'sale.create');
  delete from public.sale_drafts where id = p_draft and created_by = auth.uid();
end $$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on function public.customer_balance(uuid, uuid) from public;
revoke all on function public.save_customer(jsonb) from public;
revoke all on function public.search_customers(uuid, text, integer) from public;
revoke all on function public.pos_search(uuid, text, integer) from public;
revoke all on function public.pos_batches(uuid, uuid) from public;
revoke all on function public.sale_plan(uuid, jsonb, boolean) from public;
revoke all on function public.quote_sale(uuid, jsonb) from public;
revoke all on function public.build_invoice(uuid) from public;
revoke all on function public.get_invoice(uuid) from public;
revoke all on function public.complete_sale(jsonb) from public;
revoke all on function public.list_sales(uuid, text, date, date, bigint, integer) from public;
revoke all on function public.save_sale_draft(jsonb) from public;
revoke all on function public.delete_sale_draft(uuid) from public;

grant execute on function public.customer_balance(uuid, uuid) to authenticated;
grant execute on function public.save_customer(jsonb) to authenticated;
grant execute on function public.search_customers(uuid, text, integer) to authenticated;
grant execute on function public.pos_search(uuid, text, integer) to authenticated;
grant execute on function public.pos_batches(uuid, uuid) to authenticated;
grant execute on function public.quote_sale(uuid, jsonb) to authenticated;
grant execute on function public.get_invoice(uuid) to authenticated;
grant execute on function public.complete_sale(jsonb) to authenticated;
grant execute on function public.list_sales(uuid, text, date, date, bigint, integer) to authenticated;
grant execute on function public.save_sale_draft(jsonb) to authenticated;
grant execute on function public.delete_sale_draft(uuid) to authenticated;
