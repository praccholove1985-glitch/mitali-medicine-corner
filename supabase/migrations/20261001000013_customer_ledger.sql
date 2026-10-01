-- Phase 6: customer payments, statements and the due list.
--
-- The ledger (Phase 5) stays the single source of truth: balance = sum of entries,
-- positive = the customer owes. A payment received later is two rows written together:
-- a `payments` row (which method, which reference) and a PAYMENT ledger entry linked to it.
--
-- Error code introduced (mapped in src/server/errors.ts):
--   PH058 payment_exceeds_due   nothing is due, or the amount is more than is due.
--                               Advance deposits are not part of v1; the hint carries the due amount.

alter table public.payments add column client_request_id uuid;
create unique index payments_request_key on public.payments (branch_id, client_request_id)
  where client_request_id is not null;

alter table public.customer_ledger_entries add column payment_id bigint
  references public.payments (id) on delete restrict;
create index customer_ledger_payment_idx on public.customer_ledger_entries (payment_id)
  where payment_id is not null;

-- ---------------------------------------------------------------------------
-- Receive a payment against what a customer owes.
-- p: {branch_id, customer_id, client_request_id, method, amount, reference?, note?}
-- ---------------------------------------------------------------------------
create function public.receive_customer_payment(p jsonb) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_allowed constant text[] := array['branch_id','customer_id','client_request_id','method','amount','reference','note'];
  v_unknown text[];
  v_branch uuid;
  v_customer uuid;
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
  if p -> 'branch_id' is null or p -> 'customer_id' is null or p -> 'client_request_id' is null then
    raise exception 'branch_id, customer_id and client_request_id are required' using errcode = '22023';
  end if;

  v_branch := (p ->> 'branch_id')::uuid;
  v_customer := (p ->> 'customer_id')::uuid;
  v_request := (p ->> 'client_request_id')::uuid;
  v_method := upper(btrim(coalesce(p ->> 'method', '')));
  v_reference := nullif(btrim(p ->> 'reference'), '');
  v_note := nullif(btrim(p ->> 'note'), '');
  perform public.require_permission(v_branch, 'customer.payment');

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

  -- A retry returns the payment that was already recorded.
  perform pg_advisory_xact_lock(hashtextextended(v_branch::text || ':pay:' || v_request::text, 0));
  select * into v_existing from public.payments
   where branch_id = v_branch and client_request_id = v_request;
  if found then
    select l.id into v_entry from public.customer_ledger_entries l where l.payment_id = v_existing.id;
    return jsonb_build_object(
      'payment_id', v_existing.id, 'ledger_entry_id', v_entry, 'amount', v_existing.amount::text,
      'balance_after', (select coalesce(sum(l.amount), 0)::numeric(14,2)::text from public.customer_ledger_entries l
                         where l.customer_id = v_existing.customer_id and l.id <= v_entry),
      'replayed', true);
  end if;

  -- Serialise payments for one customer so the balance check cannot be raced.
  perform 1 from public.customers c where c.id = v_customer and c.branch_id = v_branch for update;
  if not found then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;

  select coalesce(sum(l.amount), 0) into v_before
    from public.customer_ledger_entries l where l.customer_id = v_customer and l.branch_id = v_branch;
  if v_before <= 0 or v_amount > v_before then
    raise exception 'payment exceeds what is due' using errcode = 'PH058',
      hint = jsonb_build_object('due', greatest(v_before, 0)::numeric(14,2)::text)::text;
  end if;

  insert into public.payments (branch_id, direction, method, amount, customer_id, reference, client_request_id)
  values (v_branch, 'IN', v_method, v_amount, v_customer, v_reference, v_request)
  returning id into v_payment;

  insert into public.customer_ledger_entries (branch_id, customer_id, entry_type, amount, note, payment_id)
  values (v_branch, v_customer, 'PAYMENT', -v_amount, v_note, v_payment)
  returning id into v_entry;

  perform public.write_audit(v_branch, 'customer.payment', 'customers', v_customer::text, null,
    jsonb_build_object('payment_id', v_payment, 'method', v_method, 'amount', v_amount::text,
                       'balance_before', v_before::numeric(14,2)::text, 'balance_after', (v_before - v_amount)::numeric(14,2)::text));

  return jsonb_build_object(
    'payment_id', v_payment, 'ledger_entry_id', v_entry, 'amount', v_amount::text,
    'balance_after', (v_before - v_amount)::numeric(14,2)::text, 'replayed', false);
end $$;

-- ---------------------------------------------------------------------------
-- Customer list with balances. filter: all | due | over_limit | inactive.
-- ---------------------------------------------------------------------------
create function public.list_customers(
  p_branch uuid,
  p_query text default '',
  p_filter text default 'all',
  p_limit integer default 25,
  p_offset integer default 0
) returns table (
  id uuid, name text, phone text, address text, credit_limit numeric, is_active boolean,
  balance numeric, last_activity timestamptz, over_limit boolean, total_count bigint
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
  perform public.require_permission(p_branch, 'customer.view');
  if p_filter is null or p_filter <> all (array['all','due','over_limit','inactive']) then
    raise exception 'unknown filter' using errcode = '22023';
  end if;

  return query
  with base as (
    select c.id, c.name, c.phone, c.address, c.credit_limit, c.is_active,
           coalesce(b.balance, 0) as balance, b.last_activity,
           (c.credit_limit is not null and coalesce(b.balance, 0) > c.credit_limit) as over_limit
    from public.customers c
    left join lateral (
      select sum(l.amount) as balance, max(l.created_at) as last_activity
        from public.customer_ledger_entries l
       where l.customer_id = c.id and l.branch_id = c.branch_id
    ) b on true
    where c.branch_id = p_branch
      and (v_pat = '' or c.name ilike '%' || v_pat || '%' or c.phone ilike '%' || v_pat || '%')
  ), filtered as (
    select * from base
     where case p_filter
             when 'due' then is_active and balance > 0
             when 'over_limit' then over_limit
             when 'inactive' then not is_active
             else true
           end
  )
  select f.id, f.name, f.phone, f.address, f.credit_limit, f.is_active, f.balance, f.last_activity, f.over_limit,
         count(*) over ()
    from filtered f
   order by case when p_filter in ('due','over_limit') then f.balance end desc nulls last,
            lower(f.name), f.id
   limit v_limit offset v_offset;
end $$;

-- ---------------------------------------------------------------------------
-- Branch-wide due figures for the customers page header.
-- ---------------------------------------------------------------------------
create function public.due_summary(p_branch uuid) returns table (
  total_due numeric, customers_with_due bigint, customers_over_limit bigint,
  active_customers bigint, advance_total numeric
)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_permission(p_branch, 'customer.view');
  return query
  with bal as (
    select c.id, c.credit_limit, c.is_active,
           coalesce((select sum(l.amount) from public.customer_ledger_entries l
                      where l.customer_id = c.id and l.branch_id = c.branch_id), 0) as balance
      from public.customers c where c.branch_id = p_branch
  )
  select coalesce(sum(balance) filter (where balance > 0), 0),
         count(*) filter (where balance > 0),
         count(*) filter (where credit_limit is not null and balance > credit_limit),
         count(*) filter (where is_active),
         coalesce(-sum(balance) filter (where balance < 0), 0)
    from bal;
end $$;

-- ---------------------------------------------------------------------------
-- One customer with lifetime figures.
-- ---------------------------------------------------------------------------
create function public.customer_summary(p_branch uuid, p_customer uuid) returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  c public.customers%rowtype;
  v_balance numeric;
begin
  perform public.require_permission(p_branch, 'customer.view');
  select * into c from public.customers where id = p_customer and branch_id = p_branch;
  if not found then return null; end if;
  select coalesce(sum(l.amount), 0) into v_balance
    from public.customer_ledger_entries l where l.customer_id = c.id and l.branch_id = c.branch_id;

  return jsonb_build_object(
    'id', c.id, 'name', c.name, 'phone', c.phone, 'address', c.address,
    'credit_limit', c.credit_limit::text, 'is_active', c.is_active, 'created_at', c.created_at,
    'balance', v_balance::numeric(14,2)::text,
    'available_credit', case when c.credit_limit is null then null
                             else greatest(c.credit_limit - v_balance, 0)::numeric(14,2)::text end,
    'sales_count', (select count(*) from public.sales s where s.customer_id = c.id and s.branch_id = c.branch_id),
    'sales_total', (select coalesce(sum(s.grand_total), 0)::numeric(14,2)::text from public.sales s
                     where s.customer_id = c.id and s.branch_id = c.branch_id),
    'last_sale_at', (select max(s.sold_at) from public.sales s where s.customer_id = c.id and s.branch_id = c.branch_id),
    'last_payment_at', (select max(l.created_at) from public.customer_ledger_entries l
                         where l.customer_id = c.id and l.entry_type = 'PAYMENT'),
    'can_edit', public.has_permission(p_branch, 'customer.edit'),
    'can_receive_payment', public.has_permission(p_branch, 'customer.payment')
  );
end $$;

-- ---------------------------------------------------------------------------
-- Statement for a date range (branch timezone): opening balance, every entry with its
-- running balance, closing balance. At most 1000 entries; narrow the range if truncated.
-- ---------------------------------------------------------------------------
create function public.customer_statement(
  p_branch uuid, p_customer uuid, p_from date, p_to date
) returns jsonb
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
  perform public.require_permission(p_branch, 'customer.view');
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'choose a valid date range' using errcode = '22023';
  end if;
  if p_to - p_from > 3660 then
    raise exception 'date range is too long' using errcode = '22023';
  end if;
  if not exists (select 1 from public.customers where id = p_customer and branch_id = p_branch) then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;
  select b.timezone into v_tz from public.branches b where b.id = p_branch;
  v_start := p_from::timestamp at time zone v_tz;
  v_end := (p_to + 1)::timestamp at time zone v_tz;

  select coalesce(sum(l.amount), 0) into v_opening
    from public.customer_ledger_entries l
   where l.customer_id = p_customer and l.branch_id = p_branch and l.created_at < v_start;

  select coalesce(sum(l.amount) filter (where l.amount > 0), 0),
         coalesce(-sum(l.amount) filter (where l.amount < 0), 0),
         count(*)
    into v_debits, v_credits, v_count
    from public.customer_ledger_entries l
   where l.customer_id = p_customer and l.branch_id = p_branch
     and l.created_at >= v_start and l.created_at < v_end;
  v_closing := v_opening + v_debits - v_credits;

  select coalesce(jsonb_agg(e order by e_id), '[]'::jsonb) into v_entries
  from (
    select l.id as e_id,
           jsonb_build_object(
             'id', l.id, 'at', l.created_at, 'type', l.entry_type, 'amount', l.amount::text,
             'running', (v_opening + sum(l.amount) over (order by l.created_at, l.id))::numeric(14,2)::text,
             'invoice_no', s.invoice_no, 'sale_id', l.sale_id,
             'method', p.method, 'reference', p.reference, 'note', l.note,
             'by', nullif(btrim(pr.full_name), '')) as e
      from public.customer_ledger_entries l
      left join public.sales s on s.id = l.sale_id
      left join public.payments p on p.id = l.payment_id
      left join public.profiles pr on pr.id = l.created_by
     where l.customer_id = p_customer and l.branch_id = p_branch
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

revoke all on function public.receive_customer_payment(jsonb) from public;
revoke all on function public.list_customers(uuid, text, text, integer, integer) from public;
revoke all on function public.due_summary(uuid) from public;
revoke all on function public.customer_summary(uuid, uuid) from public;
revoke all on function public.customer_statement(uuid, uuid, date, date) from public;

grant execute on function public.receive_customer_payment(jsonb) to authenticated;
grant execute on function public.list_customers(uuid, text, text, integer, integer) to authenticated;
grant execute on function public.due_summary(uuid) to authenticated;
grant execute on function public.customer_summary(uuid, uuid) to authenticated;
grant execute on function public.customer_statement(uuid, uuid, date, date) to authenticated;
