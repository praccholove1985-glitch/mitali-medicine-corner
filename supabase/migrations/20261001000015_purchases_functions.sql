-- Phase 7 / 2 of 3: supplier and purchase functions.
--
-- purchase_plan is the ONE place that prices purchase lines. quote_purchase (the entry form's
-- preview) and create_purchase both call it, so the browser never does the arithmetic.
--
-- Money rules (see docs/PHARMACY_WORKFLOWS.md):
--   * unit prices have up to 4 decimals; a line's gross is round(quantity x price, 2) half-up once
--   * discount (NONE / AMOUNT / PERCENT) comes off the gross; VAT is added on top of the net:
--     tax = round(net x rate / 100, 2)  [RULE: supplier prices are VAT-exclusive; to be confirmed]
--   * unit cost = line total / (paid + free units), 4 decimals: free stock lowers the cost per unit
--   * topping up an existing batch re-averages its cost over the units on hand

-- ---------------------------------------------------------------------------
-- Suppliers
-- ---------------------------------------------------------------------------
create function public.save_supplier(p jsonb) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_allowed constant text[] := array['id','branch_id','name','contact_person','phone','address','is_active'];
  v_unknown text[];
  v_branch uuid;
  v_id uuid;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'p must be a JSON object' using errcode = '22023';
  end if;
  select array_agg(k) into v_unknown from jsonb_object_keys(p) k where k <> all (v_allowed);
  if v_unknown is not null then
    raise exception 'unknown field(s): %', array_to_string(v_unknown, ', ') using errcode = '22023';
  end if;

  v_branch := (p ->> 'branch_id')::uuid;
  perform public.require_permission(v_branch, 'supplier.edit');
  v_id := (p ->> 'id')::uuid;

  if v_id is null then
    if not (p ? 'name') then raise exception 'name is required' using errcode = '22023'; end if;
    insert into public.suppliers (branch_id, name, contact_person, phone, address, is_active, created_by)
    values (v_branch, btrim(p ->> 'name'), nullif(btrim(p ->> 'contact_person'), ''),
            nullif(btrim(p ->> 'phone'), ''), nullif(btrim(p ->> 'address'), ''),
            coalesce((p ->> 'is_active')::boolean, true), auth.uid())
    returning id into v_id;
  else
    update public.suppliers s set
      name = case when p ? 'name' then btrim(p ->> 'name') else s.name end,
      contact_person = case when p ? 'contact_person' then nullif(btrim(p ->> 'contact_person'), '') else s.contact_person end,
      phone = case when p ? 'phone' then nullif(btrim(p ->> 'phone'), '') else s.phone end,
      address = case when p ? 'address' then nullif(btrim(p ->> 'address'), '') else s.address end,
      is_active = case when p ? 'is_active' then (p ->> 'is_active')::boolean else s.is_active end
    where s.id = v_id and s.branch_id = v_branch;
    if not found then raise exception 'supplier not found' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;

-- Pick a supplier on the purchase form: needs purchase.create or supplier.view.
create function public.search_suppliers(p_branch uuid, p_query text default '', p_limit integer default 10)
returns table (id uuid, name text, phone text)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_pat text := replace(replace(replace(btrim(coalesce(p_query, '')), '\', '\\'), '%', '\%'), '_', '\_');
  v_limit integer := least(greatest(coalesce(p_limit, 10), 1), 50);
begin
  if not (public.has_permission(p_branch, 'purchase.create') or public.has_permission(p_branch, 'supplier.view')) then
    raise exception 'permission denied: supplier.view' using errcode = '42501';
  end if;
  return query
  select s.id, s.name, s.phone
    from public.suppliers s
   where s.branch_id = p_branch and s.is_active
     and (v_pat = '' or s.name ilike '%' || v_pat || '%' or s.phone ilike '%' || v_pat || '%')
   order by lower(s.name), s.id
   limit v_limit;
end $$;

create function public.list_suppliers(
  p_branch uuid,
  p_query text default '',
  p_filter text default 'all',
  p_limit integer default 25,
  p_offset integer default 0
) returns table (
  id uuid, name text, contact_person text, phone text, address text, is_active boolean,
  balance numeric, last_activity timestamptz, total_count bigint
)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_pat text := replace(replace(replace(btrim(coalesce(p_query, '')), '\', '\\'), '%', '\%'), '_', '\_');
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset integer := least(greatest(coalesce(p_offset, 0), 0), 1000000);
begin
  perform public.require_permission(p_branch, 'supplier.view');
  if p_filter is null or p_filter <> all (array['all','due','inactive']) then
    raise exception 'unknown filter' using errcode = '22023';
  end if;

  return query
  with base as (
    select s.id, s.name, s.contact_person, s.phone, s.address, s.is_active,
           coalesce(b.balance, 0) as balance, b.last_activity
      from public.suppliers s
      left join lateral (
        select sum(l.amount) as balance, max(l.created_at) as last_activity
          from public.supplier_ledger_entries l
         where l.supplier_id = s.id and l.branch_id = s.branch_id
      ) b on true
     where s.branch_id = p_branch
       and (v_pat = '' or s.name ilike '%' || v_pat || '%' or s.phone ilike '%' || v_pat || '%'
            or s.contact_person ilike '%' || v_pat || '%')
  ), filtered as (
    select * from base
     where case p_filter
             when 'due' then is_active and balance > 0
             when 'inactive' then not is_active
             else true
           end
  )
  select f.id, f.name, f.contact_person, f.phone, f.address, f.is_active, f.balance, f.last_activity,
         count(*) over ()
    from filtered f
   order by case when p_filter = 'due' then f.balance end desc nulls last, lower(f.name), f.id
   limit v_limit offset v_offset;
end $$;

create function public.supplier_due_summary(p_branch uuid) returns table (
  total_payable numeric, suppliers_with_due bigint, active_suppliers bigint, advance_total numeric
)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_permission(p_branch, 'supplier.view');
  return query
  with bal as (
    select s.id, s.is_active,
           coalesce((select sum(l.amount) from public.supplier_ledger_entries l
                      where l.supplier_id = s.id and l.branch_id = s.branch_id), 0) as balance
      from public.suppliers s where s.branch_id = p_branch
  )
  select coalesce(sum(balance) filter (where balance > 0), 0),
         count(*) filter (where balance > 0),
         count(*) filter (where is_active),
         coalesce(-sum(balance) filter (where balance < 0), 0)
    from bal;
end $$;

create function public.supplier_summary(p_branch uuid, p_supplier uuid) returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  s public.suppliers%rowtype;
  v_balance numeric;
  v_cost boolean := public.has_permission(p_branch, 'purchase.view_cost') and public.has_permission(p_branch, 'purchase.view');
begin
  perform public.require_permission(p_branch, 'supplier.view');
  select * into s from public.suppliers where id = p_supplier and branch_id = p_branch;
  if not found then return null; end if;
  select coalesce(sum(l.amount), 0) into v_balance
    from public.supplier_ledger_entries l where l.supplier_id = s.id and l.branch_id = s.branch_id;

  return jsonb_build_object(
    'id', s.id, 'name', s.name, 'contact_person', s.contact_person, 'phone', s.phone,
    'address', s.address, 'is_active', s.is_active, 'created_at', s.created_at,
    'balance', v_balance::numeric(14,2)::text,
    'purchases_count', case when v_cost then (select count(*) from public.purchases x where x.supplier_id = s.id and x.branch_id = s.branch_id) end,
    'purchases_total', case when v_cost then (select coalesce(sum(x.grand_total), 0)::numeric(14,2)::text from public.purchases x where x.supplier_id = s.id and x.branch_id = s.branch_id) end,
    'last_purchase_at', case when v_cost then (select max(x.created_at) from public.purchases x where x.supplier_id = s.id and x.branch_id = s.branch_id) end,
    'last_payment_at', (select max(l.created_at) from public.supplier_ledger_entries l where l.supplier_id = s.id and l.entry_type = 'PAYMENT'),
    'can_edit', public.has_permission(p_branch, 'supplier.edit'),
    'can_pay', public.has_permission(p_branch, 'supplier.payment'),
    'can_purchase', public.has_permission(p_branch, 'purchase.create') and public.has_permission(p_branch, 'purchase.view_cost')
  );
end $$;

create function public.supplier_statement(p_branch uuid, p_supplier uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_tz text;
  v_start timestamptz;
  v_end timestamptz;
  v_opening numeric;
  v_closing numeric;
  v_debits numeric;
  v_credits numeric;
  v_count integer;
  v_entries jsonb;
  c_cap constant integer := 1000;
begin
  perform public.require_permission(p_branch, 'supplier.view');
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'choose a valid date range' using errcode = '22023';
  end if;
  if p_to - p_from > 3660 then
    raise exception 'date range is too long' using errcode = '22023';
  end if;
  if not exists (select 1 from public.suppliers where id = p_supplier and branch_id = p_branch) then
    raise exception 'supplier not found' using errcode = 'P0002';
  end if;
  select b.timezone into v_tz from public.branches b where b.id = p_branch;
  v_start := p_from::timestamp at time zone v_tz;
  v_end := (p_to + 1)::timestamp at time zone v_tz;

  select coalesce(sum(l.amount), 0) into v_opening
    from public.supplier_ledger_entries l
   where l.supplier_id = p_supplier and l.branch_id = p_branch and l.created_at < v_start;

  select coalesce(sum(l.amount) filter (where l.amount > 0), 0),
         coalesce(-sum(l.amount) filter (where l.amount < 0), 0),
         count(*)
    into v_debits, v_credits, v_count
    from public.supplier_ledger_entries l
   where l.supplier_id = p_supplier and l.branch_id = p_branch
     and l.created_at >= v_start and l.created_at < v_end;
  v_closing := v_opening + v_debits - v_credits;

  select coalesce(jsonb_agg(e order by e_id), '[]'::jsonb) into v_entries
  from (
    select l.id as e_id,
           jsonb_build_object(
             'id', l.id, 'at', l.created_at, 'type', l.entry_type, 'amount', l.amount::text,
             'running', (v_opening + sum(l.amount) over (order by l.created_at, l.id))::numeric(14,2)::text,
             'purchase_no', pu.purchase_no, 'purchase_id', l.purchase_id,
             'supplier_invoice_no', pu.supplier_invoice_no,
             'method', p.method, 'reference', p.reference, 'note', l.note,
             'by', nullif(btrim(pr.full_name), '')) as e
      from public.supplier_ledger_entries l
      left join public.purchases pu on pu.id = l.purchase_id
      left join public.payments p on p.id = l.payment_id
      left join public.profiles pr on pr.id = l.created_by
     where l.supplier_id = p_supplier and l.branch_id = p_branch
       and l.created_at >= v_start and l.created_at < v_end
     order by l.created_at, l.id
     limit c_cap
  ) t;

  return jsonb_build_object(
    'from', p_from, 'to', p_to,
    'opening', v_opening::numeric(14,2)::text, 'closing', v_closing::numeric(14,2)::text,
    'total_charges', v_debits::numeric(14,2)::text, 'total_credits', v_credits::numeric(14,2)::text,
    'entry_count', v_count, 'truncated', v_count > c_cap,
    'entries', v_entries);
end $$;

-- ---------------------------------------------------------------------------
-- Pay a supplier what we owe. p: {branch_id, supplier_id, client_request_id, method, amount,
-- reference?, note?}. Cannot exceed what is owed; a retry returns the original payment.
-- ---------------------------------------------------------------------------
create function public.pay_supplier(p jsonb) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_allowed constant text[] := array['branch_id','supplier_id','client_request_id','method','amount','reference','note'];
  v_unknown text[];
  v_branch uuid;
  v_supplier uuid;
  v_request uuid;
  v_method text;
  v_amount numeric;
  v_reference text;
  v_note text;
  v_existing public.payments%rowtype;
  v_before numeric;
  v_payment bigint;
  v_entry bigint;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'p must be a JSON object' using errcode = '22023';
  end if;
  select array_agg(k) into v_unknown from jsonb_object_keys(p) k where k <> all (v_allowed);
  if v_unknown is not null then
    raise exception 'unknown field(s): %', array_to_string(v_unknown, ', ') using errcode = '22023';
  end if;
  if p -> 'branch_id' is null or p -> 'supplier_id' is null or p -> 'client_request_id' is null then
    raise exception 'branch_id, supplier_id and client_request_id are required' using errcode = '22023';
  end if;

  v_branch := (p ->> 'branch_id')::uuid;
  v_supplier := (p ->> 'supplier_id')::uuid;
  v_request := (p ->> 'client_request_id')::uuid;
  v_method := upper(btrim(coalesce(p ->> 'method', '')));
  v_reference := nullif(btrim(p ->> 'reference'), '');
  v_note := nullif(btrim(p ->> 'note'), '');
  perform public.require_permission(v_branch, 'supplier.payment');

  if v_method <> all (array['CASH','BKASH','NAGAD','ROCKET','CARD','BANK']) then
    raise exception 'payment method must be one of the money methods' using errcode = '22023';
  end if;
  begin
    v_amount := (p ->> 'amount')::numeric;
  exception when others then
    raise exception 'amount must be a number' using errcode = '22023';
  end;
  if v_amount is null or v_amount <= 0 or v_amount <> round(v_amount, 2) then
    raise exception 'amount must be above 0 with at most 2 decimals' using errcode = '22023';
  end if;
  if v_reference is not null and length(v_reference) > 64 then
    raise exception 'reference is too long' using errcode = '22023';
  end if;
  if v_note is not null and length(v_note) > 300 then
    raise exception 'note is too long' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_branch::text || ':pay:' || v_request::text, 0));
  select * into v_existing from public.payments
   where branch_id = v_branch and client_request_id = v_request;
  if found then
    select l.id into v_entry from public.supplier_ledger_entries l where l.payment_id = v_existing.id;
    return jsonb_build_object(
      'payment_id', v_existing.id, 'ledger_entry_id', v_entry, 'amount', v_existing.amount::text,
      'balance_after', (select coalesce(sum(l.amount), 0)::numeric(14,2)::text from public.supplier_ledger_entries l
                         where l.supplier_id = v_existing.supplier_id and l.id <= v_entry),
      'replayed', true);
  end if;

  perform 1 from public.suppliers s where s.id = v_supplier and s.branch_id = v_branch for update;
  if not found then
    raise exception 'supplier not found' using errcode = 'P0002';
  end if;

  select coalesce(sum(l.amount), 0) into v_before
    from public.supplier_ledger_entries l where l.supplier_id = v_supplier and l.branch_id = v_branch;
  if v_before <= 0 or v_amount > v_before then
    raise exception 'payment exceeds what is owed' using errcode = 'PH060',
      hint = jsonb_build_object('due', greatest(v_before, 0)::numeric(14,2)::text)::text;
  end if;

  insert into public.payments (branch_id, direction, method, amount, supplier_id, reference, client_request_id)
  values (v_branch, 'OUT', v_method, v_amount, v_supplier, v_reference, v_request)
  returning id into v_payment;

  insert into public.supplier_ledger_entries (branch_id, supplier_id, entry_type, amount, note, payment_id)
  values (v_branch, v_supplier, 'PAYMENT', -v_amount, v_note, v_payment)
  returning id into v_entry;

  perform public.write_audit(v_branch, 'supplier.payment', 'suppliers', v_supplier::text, null,
    jsonb_build_object('payment_id', v_payment, 'method', v_method, 'amount', v_amount::text,
                       'balance_before', v_before::numeric(14,2)::text,
                       'balance_after', (v_before - v_amount)::numeric(14,2)::text));

  return jsonb_build_object(
    'payment_id', v_payment, 'ledger_entry_id', v_entry, 'amount', v_amount::text,
    'balance_after', (v_before - v_amount)::numeric(14,2)::text, 'replayed', false);
end $$;

-- ---------------------------------------------------------------------------
-- Pricing a purchase: pure arithmetic, no table access.
-- Each item: {medicine_id, batch_number, expiry_date, quantity, free_quantity, unit_price,
-- discount_type, discount_value, tax_rate, sale_price, mrp}
-- ---------------------------------------------------------------------------
create function public.purchase_plan(p_items jsonb) returns jsonb
language plpgsql immutable
set search_path = public, pg_temp
as $$
declare
  v_allowed constant text[] := array['medicine_id','batch_number','expiry_date','quantity','free_quantity',
    'unit_price','discount_type','discount_value','tax_rate','sale_price','mrp'];
  v_line jsonb;
  v_unknown text[];
  v_lines jsonb := '[]'::jsonb;
  v_n integer := 0;
  v_qty integer;
  v_free integer;
  v_price numeric;
  v_gross numeric;
  v_dtype text;
  v_dval numeric;
  v_disc numeric;
  v_rate numeric;
  v_net numeric;
  v_tax numeric;
  v_total numeric;
  v_cost numeric;
  v_sub numeric := 0;
  v_dt numeric := 0;
  v_tt numeric := 0;
  v_gt numeric := 0;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'the purchase has no lines' using errcode = 'PH062';
  end if;
  if jsonb_array_length(p_items) > 200 then
    raise exception 'a purchase can have at most 200 lines' using errcode = '22023';
  end if;

  for v_line in select * from jsonb_array_elements(p_items) loop
    v_n := v_n + 1;
    if jsonb_typeof(v_line) <> 'object' then
      raise exception 'line % must be an object', v_n using errcode = '22023';
    end if;
    select array_agg(k) into v_unknown from jsonb_object_keys(v_line) k where k <> all (v_allowed);
    if v_unknown is not null then
      raise exception 'unknown line field(s): %', array_to_string(v_unknown, ', ') using errcode = '22023';
    end if;

    v_qty := coalesce((v_line ->> 'quantity')::integer, 0);
    v_free := coalesce((v_line ->> 'free_quantity')::integer, 0);
    if v_qty < 0 or v_free < 0 or v_qty + v_free <= 0 or v_qty > 1000000 or v_free > 1000000 then
      raise exception 'line %: quantity must be above 0 (free units count)', v_n using errcode = '22023';
    end if;

    v_price := (v_line ->> 'unit_price')::numeric;
    if v_price is null or v_price < 0 or v_price > 99999999 or v_price <> round(v_price, 4) then
      raise exception 'line %: unit price must be 0 or more with at most 4 decimals', v_n using errcode = '22023';
    end if;
    v_gross := round(v_qty * v_price, 2);

    v_dtype := upper(coalesce(nullif(btrim(v_line ->> 'discount_type'), ''), 'NONE'));
    v_dval := coalesce((v_line ->> 'discount_value')::numeric, 0);
    if v_dtype = 'NONE' then
      v_disc := 0;
    elsif v_dtype = 'AMOUNT' then
      if v_dval < 0 or v_dval <> round(v_dval, 2) or v_dval > v_gross then
        raise exception 'line %: discount is not valid', v_n using errcode = 'PH050';
      end if;
      v_disc := v_dval;
    elsif v_dtype = 'PERCENT' then
      if v_dval < 0 or v_dval > 100 then
        raise exception 'line %: discount is not valid', v_n using errcode = 'PH050';
      end if;
      v_disc := round(v_gross * v_dval / 100, 2);
    else
      raise exception 'line %: discount type must be NONE, AMOUNT or PERCENT', v_n using errcode = '22023';
    end if;

    v_rate := coalesce((v_line ->> 'tax_rate')::numeric, 0);
    if v_rate < 0 or v_rate > 100 or v_rate <> round(v_rate, 2) then
      raise exception 'line %: tax rate must be between 0 and 100', v_n using errcode = '22023';
    end if;

    v_net := v_gross - v_disc;
    v_tax := round(v_net * v_rate / 100, 2);
    v_total := v_net + v_tax;
    v_cost := round(v_total / (v_qty + v_free), 4);

    v_sub := v_sub + v_gross;
    v_dt := v_dt + v_disc;
    v_tt := v_tt + v_tax;
    v_gt := v_gt + v_total;

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'line_no', v_n,
      'medicine_id', v_line ->> 'medicine_id',
      'batch_number', btrim(coalesce(v_line ->> 'batch_number', '')),
      'expiry_date', v_line ->> 'expiry_date',
      'quantity', v_qty, 'free_quantity', v_free,
      'unit_price', v_price::text,
      'gross', v_gross::numeric(14,2)::text, 'discount', v_disc::numeric(14,2)::text,
      'tax_rate', v_rate::numeric(5,2)::text, 'tax_amount', v_tax::numeric(14,2)::text,
      'line_total', v_total::numeric(14,2)::text, 'unit_cost', v_cost::numeric(14,4)::text,
      'sale_price', v_line ->> 'sale_price', 'mrp', v_line ->> 'mrp'));
  end loop;

  return jsonb_build_object(
    'lines', v_lines,
    'totals', jsonb_build_object(
      'subtotal', v_sub::numeric(14,2)::text, 'discount_total', v_dt::numeric(14,2)::text,
      'tax_total', v_tt::numeric(14,2)::text, 'grand_total', v_gt::numeric(14,2)::text));
end $$;

-- The entry form's preview. Same arithmetic as create_purchase; adds per-line facts the form shows:
-- whether the line tops up an existing batch, and days to expiry.
create function public.quote_purchase(p_branch uuid, p_supplier uuid, p_items jsonb) returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_plan jsonb;
  v_today date;
  v_line jsonb;
  v_out jsonb := '[]'::jsonb;
  v_expiry date;
  v_exists boolean;
begin
  perform public.require_permission(p_branch, 'purchase.create');
  perform public.require_permission(p_branch, 'purchase.view_cost');
  v_plan := public.purchase_plan(p_items);
  v_today := public.branch_today(p_branch);

  for v_line in select * from jsonb_array_elements(v_plan -> 'lines') loop
    v_expiry := nullif(v_line ->> 'expiry_date', '')::date;
    v_exists := v_expiry is not null and (v_line ->> 'batch_number') <> '' and exists (
      select 1 from public.medicine_batches b
       where b.branch_id = p_branch and b.medicine_id = (v_line ->> 'medicine_id')::uuid
         and b.supplier_id is not distinct from p_supplier
         and b.batch_number = v_line ->> 'batch_number' and b.expiry_date = v_expiry);
    v_out := v_out || jsonb_build_array(v_line || jsonb_build_object(
      'tops_up_batch', v_exists,
      'days_to_expiry', case when v_expiry is null then null else v_expiry - v_today end));
  end loop;

  return jsonb_build_object('lines', v_out, 'totals', v_plan -> 'totals');
end $$;

-- ---------------------------------------------------------------------------
-- Record a purchase. p: {branch_id, client_request_id, supplier_id, supplier_invoice_no,
-- invoice_date, notes?, items, payments?}. Payments (money methods) may cover part or none of the
-- total; the rest stays owed to the supplier. A repeated client_request_id returns the original.
-- ---------------------------------------------------------------------------
create function public.create_purchase(p jsonb) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_allowed constant text[] := array['branch_id','client_request_id','supplier_id','supplier_invoice_no',
    'invoice_date','notes','items','payments'];
  v_unknown text[];
  v_branch uuid;
  v_request uuid;
  v_supplier uuid;
  v_invoice text;
  v_date date;
  v_notes text;
  v_today date;
  v_existing public.purchases%rowtype;
  v_dup text;
  v_plan jsonb;
  v_totals jsonb;
  v_grand numeric;
  v_pay jsonb;
  v_pay_method text;
  v_pay_amount numeric;
  v_pay_ref text;
  v_paid numeric := 0;
  v_seq bigint;
  v_prefix text;
  v_no text;
  v_purchase uuid := gen_random_uuid();
  v_line jsonb;
  v_med public.medicines%rowtype;
  v_expiry date;
  v_n integer;
  v_batch public.medicine_batches%rowtype;
  v_batch_id uuid;
  v_new boolean;
  v_unit_cost numeric;
  v_new_cost numeric;
  v_sale numeric;
  v_mrp numeric;
  v_payment bigint;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'p must be a JSON object' using errcode = '22023';
  end if;
  select array_agg(k) into v_unknown from jsonb_object_keys(p) k where k <> all (v_allowed);
  if v_unknown is not null then
    raise exception 'unknown field(s): %', array_to_string(v_unknown, ', ') using errcode = '22023';
  end if;
  if p -> 'branch_id' is null or p -> 'client_request_id' is null or p -> 'supplier_id' is null
     or p -> 'supplier_invoice_no' is null or p -> 'invoice_date' is null then
    raise exception 'branch_id, client_request_id, supplier_id, supplier_invoice_no and invoice_date are required'
      using errcode = '22023';
  end if;

  v_branch := (p ->> 'branch_id')::uuid;
  v_request := (p ->> 'client_request_id')::uuid;
  v_supplier := (p ->> 'supplier_id')::uuid;
  v_invoice := btrim(p ->> 'supplier_invoice_no');
  v_date := (p ->> 'invoice_date')::date;
  v_notes := nullif(btrim(p ->> 'notes'), '');
  perform public.require_permission(v_branch, 'purchase.create');
  perform public.require_permission(v_branch, 'purchase.view_cost');

  if length(v_invoice) not between 1 and 64 then
    raise exception 'supplier invoice number must be 1 to 64 characters' using errcode = '22023';
  end if;
  if v_notes is not null and length(v_notes) > 500 then
    raise exception 'notes are too long' using errcode = '22023';
  end if;
  v_today := public.branch_today(v_branch);
  if v_date > v_today then
    raise exception 'the invoice date cannot be in the future' using errcode = '22023';
  end if;

  -- The same request twice (double click, retry): one purchase.
  perform pg_advisory_xact_lock(hashtextextended(v_branch::text || ':purchase:' || v_request::text, 0));
  select * into v_existing from public.purchases where branch_id = v_branch and client_request_id = v_request;
  if found then
    return jsonb_build_object('purchase_id', v_existing.id, 'purchase_no', v_existing.purchase_no,
      'grand_total', v_existing.grand_total::text, 'paid_total', v_existing.paid_total::text,
      'due_total', v_existing.due_total::text, 'replayed', true);
  end if;

  -- Serialise purchases and payments for one supplier.
  perform 1 from public.suppliers s where s.id = v_supplier and s.branch_id = v_branch and s.is_active for update;
  if not found then
    raise exception 'supplier not found or inactive' using errcode = 'P0002';
  end if;

  select pu.purchase_no into v_dup from public.purchases pu
   where pu.branch_id = v_branch and pu.supplier_id = v_supplier
     and lower(btrim(pu.supplier_invoice_no)) = lower(v_invoice);
  if v_dup is not null then
    raise exception 'that supplier invoice was already entered' using errcode = 'PH059',
      hint = jsonb_build_object('purchase_no', v_dup)::text;
  end if;

  v_plan := public.purchase_plan(p -> 'items');
  v_totals := v_plan -> 'totals';
  v_grand := (v_totals ->> 'grand_total')::numeric;

  -- Payments made now.
  if p ? 'payments' and p -> 'payments' <> 'null'::jsonb then
    if jsonb_typeof(p -> 'payments') <> 'array' or jsonb_array_length(p -> 'payments') > 12 then
      raise exception 'payments must be a list of at most 12' using errcode = '22023';
    end if;
    for v_pay in select * from jsonb_array_elements(p -> 'payments') loop
      if jsonb_typeof(v_pay) <> 'object' or exists (select 1 from jsonb_object_keys(v_pay) k where k <> all (array['method','amount','reference'])) then
        raise exception 'a payment has unknown fields' using errcode = '22023';
      end if;
      v_pay_method := upper(btrim(coalesce(v_pay ->> 'method', '')));
      if v_pay_method <> all (array['CASH','BKASH','NAGAD','ROCKET','CARD','BANK']) then
        raise exception 'payment method must be one of the money methods (what is left stays owed)' using errcode = '22023';
      end if;
      v_pay_amount := (v_pay ->> 'amount')::numeric;
      if v_pay_amount is null or v_pay_amount <= 0 or v_pay_amount <> round(v_pay_amount, 2) then
        raise exception 'payment amount must be above 0 with at most 2 decimals' using errcode = '22023';
      end if;
      if length(coalesce(v_pay ->> 'reference', '')) > 64 then
        raise exception 'payment reference is too long' using errcode = '22023';
      end if;
      v_paid := v_paid + v_pay_amount;
    end loop;
  end if;
  if v_paid > v_grand then
    raise exception 'payments are more than the purchase total' using errcode = 'PH061',
      hint = jsonb_build_object('grand_total', v_grand::numeric(14,2)::text)::text;
  end if;

  insert into public.purchase_counters (branch_id, last_seq) values (v_branch, 1)
  on conflict (branch_id) do update set last_seq = public.purchase_counters.last_seq + 1
  returning last_seq into v_seq;
  select coalesce(nullif(btrim(b.settings ->> 'purchase_prefix'), ''), 'PUR') into v_prefix
    from public.branches b where b.id = v_branch;
  v_no := v_prefix || '-' || lpad(v_seq::text, 6, '0');

  insert into public.purchases
    (id, branch_id, purchase_seq, purchase_no, supplier_id, supplier_invoice_no, invoice_date,
     subtotal, discount_total, tax_total, grand_total, paid_total, due_total, notes, client_request_id)
  values
    (v_purchase, v_branch, v_seq, v_no, v_supplier, v_invoice, v_date,
     (v_totals ->> 'subtotal')::numeric, (v_totals ->> 'discount_total')::numeric,
     (v_totals ->> 'tax_total')::numeric, v_grand, v_paid, v_grand - v_paid, v_notes, v_request);

  for v_line in select * from jsonb_array_elements(v_plan -> 'lines') loop
    select * into v_med from public.medicines m where m.id = (v_line ->> 'medicine_id')::uuid and m.is_active;
    if not found then
      raise exception 'line %: medicine not found or inactive', v_line ->> 'line_no' using errcode = 'P0002';
    end if;
    if (v_line ->> 'batch_number') = '' or length(v_line ->> 'batch_number') > 64 then
      raise exception 'line %: enter the batch number (up to 64 characters)', v_line ->> 'line_no' using errcode = '22023';
    end if;
    v_expiry := (v_line ->> 'expiry_date')::date;
    if v_expiry is null or v_expiry <= v_today then
      raise exception 'line %: expiry date must be after today', v_line ->> 'line_no' using errcode = 'PH030';
    end if;

    v_n := (v_line ->> 'quantity')::integer + (v_line ->> 'free_quantity')::integer;
    v_unit_cost := (v_line ->> 'unit_cost')::numeric;

    select * into v_batch from public.medicine_batches b
     where b.branch_id = v_branch and b.medicine_id = v_med.id
       and b.supplier_id is not distinct from v_supplier
       and b.batch_number = v_line ->> 'batch_number' and b.expiry_date = v_expiry
       for update;

    if found then
      v_new := false;
      v_batch_id := v_batch.id;
      -- Cost of a mixed batch: the average over the units on hand. Prices are left alone (price.edit).
      v_new_cost := case when v_batch.quantity = 0 then v_unit_cost
                         else round((v_batch.quantity * v_batch.purchase_price + v_n * v_unit_cost)
                                    / (v_batch.quantity + v_n), 4) end;
      update public.medicine_batches
         set quantity = quantity + v_n, purchase_price = v_new_cost
       where id = v_batch_id;
    else
      v_new := true;
      v_sale := coalesce((v_line ->> 'sale_price')::numeric, v_med.default_sale_price);
      v_mrp := coalesce((v_line ->> 'mrp')::numeric, v_med.mrp);
      if v_sale is null then
        raise exception 'line %: enter a sale price for the new batch', v_line ->> 'line_no' using errcode = 'PH063';
      end if;
      if v_sale < 0 or v_sale <> round(v_sale, 4) or (v_mrp is not null and (v_mrp < 0 or v_mrp <> round(v_mrp, 4))) then
        raise exception 'line %: prices must be 0 or more with at most 4 decimals', v_line ->> 'line_no' using errcode = '22023';
      end if;
      if v_mrp is not null and v_sale > v_mrp then
        raise exception 'line %: sale price % is above the MRP %', v_line ->> 'line_no', v_sale, v_mrp using errcode = 'PH031';
      end if;
      v_batch_id := gen_random_uuid();
      insert into public.medicine_batches
        (id, branch_id, medicine_id, supplier_id, batch_number, expiry_date,
         purchase_price, sale_price, mrp, quantity, created_by)
      values
        (v_batch_id, v_branch, v_med.id, v_supplier, v_line ->> 'batch_number', v_expiry,
         v_unit_cost, v_sale, v_mrp, v_n, auth.uid());
    end if;

    insert into public.stock_movements
      (branch_id, medicine_id, batch_id, quantity_delta, movement_type, reference_type, reference_id, reason, user_id)
    values
      (v_branch, v_med.id, v_batch_id, v_n, 'PURCHASE', 'purchase', v_purchase::text, null, auth.uid());

    insert into public.purchase_items
      (purchase_id, line_no, medicine_id, medicine_name, strength, unit, batch_id, batch_number, expiry_date,
       quantity, free_quantity, unit_price, gross, discount, tax_rate, tax_amount, line_total, unit_cost, new_batch)
    values
      (v_purchase, (v_line ->> 'line_no')::integer, v_med.id, v_med.name, v_med.strength, v_med.unit,
       v_batch_id, v_line ->> 'batch_number', v_expiry,
       (v_line ->> 'quantity')::integer, (v_line ->> 'free_quantity')::integer,
       (v_line ->> 'unit_price')::numeric, (v_line ->> 'gross')::numeric, (v_line ->> 'discount')::numeric,
       (v_line ->> 'tax_rate')::numeric, (v_line ->> 'tax_amount')::numeric, (v_line ->> 'line_total')::numeric,
       v_unit_cost, v_new);
  end loop;

  -- The ledger records the whole invoice, then each payment made now.
  if v_grand > 0 then
    insert into public.supplier_ledger_entries (branch_id, supplier_id, entry_type, amount, purchase_id, note)
    values (v_branch, v_supplier, 'PURCHASE_DUE', v_grand, v_purchase, 'Purchase ' || v_no);
  end if;
  if p ? 'payments' and p -> 'payments' <> 'null'::jsonb then
    for v_pay in select * from jsonb_array_elements(p -> 'payments') loop
      v_pay_method := upper(btrim(v_pay ->> 'method'));
      v_pay_amount := (v_pay ->> 'amount')::numeric;
      v_pay_ref := nullif(btrim(v_pay ->> 'reference'), '');
      insert into public.payments (branch_id, direction, method, amount, supplier_id, purchase_id, reference)
      values (v_branch, 'OUT', v_pay_method, v_pay_amount, v_supplier, v_purchase, v_pay_ref)
      returning id into v_payment;
      insert into public.supplier_ledger_entries (branch_id, supplier_id, entry_type, amount, purchase_id, payment_id, note)
      values (v_branch, v_supplier, 'PAYMENT', -v_pay_amount, v_purchase, v_payment, 'Paid with purchase ' || v_no);
    end loop;
  end if;

  perform public.write_audit(v_branch, 'purchase.create', 'purchases', v_purchase::text, null,
    jsonb_build_object('purchase_no', v_no, 'supplier_id', v_supplier, 'supplier_invoice_no', v_invoice,
                       'grand_total', v_grand::numeric(14,2)::text, 'paid_total', v_paid::numeric(14,2)::text,
                       'due_total', (v_grand - v_paid)::numeric(14,2)::text,
                       'lines', jsonb_array_length(v_plan -> 'lines')));

  return jsonb_build_object('purchase_id', v_purchase, 'purchase_no', v_no,
    'grand_total', v_grand::numeric(14,2)::text, 'paid_total', v_paid::numeric(14,2)::text,
    'due_total', (v_grand - v_paid)::numeric(14,2)::text, 'replayed', false);
end $$;

-- ---------------------------------------------------------------------------
-- Reading purchases (cost information: purchase.view and purchase.view_cost)
-- ---------------------------------------------------------------------------
create function public.list_purchases(
  p_branch uuid,
  p_supplier uuid default null,
  p_query text default '',
  p_from date default null,
  p_to date default null,
  p_before_seq bigint default null,
  p_limit integer default 25
) returns table (
  purchase_id uuid, purchase_no text, purchase_seq bigint, supplier_id uuid, supplier_name text,
  supplier_invoice_no text, invoice_date date, created_at timestamptz, item_count integer,
  grand_total numeric, paid_total numeric, due_total numeric
)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_pat text := replace(replace(replace(btrim(coalesce(p_query, '')), '\', '\\'), '%', '\%'), '_', '\_');
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 101);
begin
  perform public.require_permission(p_branch, 'purchase.view');
  perform public.require_permission(p_branch, 'purchase.view_cost');
  return query
  select pu.id, pu.purchase_no, pu.purchase_seq, pu.supplier_id, s.name, pu.supplier_invoice_no,
         pu.invoice_date, pu.created_at,
         (select count(*)::integer from public.purchase_items i where i.purchase_id = pu.id),
         pu.grand_total, pu.paid_total, pu.due_total
    from public.purchases pu
    join public.suppliers s on s.id = pu.supplier_id
   where pu.branch_id = p_branch
     and (p_supplier is null or pu.supplier_id = p_supplier)
     and (p_from is null or pu.invoice_date >= p_from)
     and (p_to is null or pu.invoice_date <= p_to)
     and (p_before_seq is null or pu.purchase_seq < p_before_seq)
     and (v_pat = '' or pu.purchase_no ilike '%' || v_pat || '%'
          or pu.supplier_invoice_no ilike '%' || v_pat || '%' or s.name ilike '%' || v_pat || '%')
   order by pu.purchase_seq desc
   limit v_limit;
end $$;

create function public.get_purchase(p_purchase uuid) returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  pu public.purchases%rowtype;
begin
  select * into pu from public.purchases where id = p_purchase;
  if not found then return null; end if;
  perform public.require_permission(pu.branch_id, 'purchase.view');
  perform public.require_permission(pu.branch_id, 'purchase.view_cost');

  return jsonb_build_object(
    'id', pu.id, 'purchase_no', pu.purchase_no, 'created_at', pu.created_at,
    'supplier', (select jsonb_build_object('id', s.id, 'name', s.name, 'phone', s.phone) from public.suppliers s where s.id = pu.supplier_id),
    'supplier_invoice_no', pu.supplier_invoice_no, 'invoice_date', pu.invoice_date, 'notes', pu.notes,
    'recorded_by', (select nullif(btrim(pr.full_name), '') from public.profiles pr where pr.id = pu.created_by),
    'totals', jsonb_build_object('subtotal', pu.subtotal::text, 'discount_total', pu.discount_total::text,
      'tax_total', pu.tax_total::text, 'grand_total', pu.grand_total::text,
      'paid_total', pu.paid_total::text, 'due_total', pu.due_total::text),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'line_no', i.line_no, 'medicine_id', i.medicine_id, 'name', i.medicine_name, 'strength', i.strength,
        'unit', i.unit, 'batch_id', i.batch_id, 'batch_number', i.batch_number, 'expiry_date', i.expiry_date,
        'quantity', i.quantity, 'free_quantity', i.free_quantity, 'unit_price', i.unit_price::text,
        'gross', i.gross::text, 'discount', i.discount::text, 'tax_rate', i.tax_rate::text,
        'tax_amount', i.tax_amount::text, 'line_total', i.line_total::text, 'unit_cost', i.unit_cost::text,
        'new_batch', i.new_batch) order by i.line_no)
      from public.purchase_items i where i.purchase_id = pu.id), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object(
        'method', p.method, 'amount', p.amount::text, 'reference', p.reference) order by p.id)
      from public.payments p where p.purchase_id = pu.id), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- Privileges: callable by signed-in users only; each checks its own permission.
-- purchase_plan is internal arithmetic and is not exposed.
-- ---------------------------------------------------------------------------
revoke all on function public.save_supplier(jsonb) from public;
revoke all on function public.search_suppliers(uuid, text, integer) from public;
revoke all on function public.list_suppliers(uuid, text, text, integer, integer) from public;
revoke all on function public.supplier_due_summary(uuid) from public;
revoke all on function public.supplier_summary(uuid, uuid) from public;
revoke all on function public.supplier_statement(uuid, uuid, date, date) from public;
revoke all on function public.pay_supplier(jsonb) from public;
revoke all on function public.purchase_plan(jsonb) from public;
revoke all on function public.quote_purchase(uuid, uuid, jsonb) from public;
revoke all on function public.create_purchase(jsonb) from public;
revoke all on function public.list_purchases(uuid, uuid, text, date, date, bigint, integer) from public;
revoke all on function public.get_purchase(uuid) from public;

grant execute on function public.save_supplier(jsonb) to authenticated;
grant execute on function public.search_suppliers(uuid, text, integer) to authenticated;
grant execute on function public.list_suppliers(uuid, text, text, integer, integer) to authenticated;
grant execute on function public.supplier_due_summary(uuid) to authenticated;
grant execute on function public.supplier_summary(uuid, uuid) to authenticated;
grant execute on function public.supplier_statement(uuid, uuid, date, date) to authenticated;
grant execute on function public.pay_supplier(jsonb) to authenticated;
grant execute on function public.quote_purchase(uuid, uuid, jsonb) to authenticated;
grant execute on function public.create_purchase(jsonb) to authenticated;
grant execute on function public.list_purchases(uuid, uuid, text, date, date, bigint, integer) to authenticated;
grant execute on function public.get_purchase(uuid) to authenticated;
