-- Phase 4: inventory reads and stock adjustments.
--
-- All reads are functions so cost can be withheld (value_at_cost is null unless the
-- caller holds purchase.view_cost) and so expiry is judged in the branch timezone.
-- All writes are functions that move quantity and write the movement together; the
-- commit-time invariant from Phase 3 backs them up.
--
-- Error codes introduced (mapped in src/server/errors.ts):
--   PH041 insufficient_stock      cannot remove more than is on hand
--   PH042 batch_not_expired       EXPIRED write-offs need an expired batch
--   PH043 nothing_to_write_off    no expired stock among the chosen batches

-- Idempotency for adjustments: a retried form submit must not adjust twice.
alter table public.stock_movements add column client_request_id uuid;
create unique index stock_movements_request_key
  on public.stock_movements (branch_id, client_request_id)
  where client_request_id is not null;

-- Newest-first paging by id within a branch / medicine / batch.
create index stock_movements_branch_id_idx on public.stock_movements (branch_id, id desc);
create index stock_movements_medicine_id_idx on public.stock_movements (medicine_id, id desc);
create index stock_movements_batch_id_idx on public.stock_movements (batch_id, id desc);

-- ---------------------------------------------------------------------------
-- Adjustments
-- ---------------------------------------------------------------------------

-- One manual stock change on one batch. p keys: batch_id, movement_type
-- (ADJUSTMENT | DAMAGE | EXPIRED | CORRECTION), quantity_delta (signed), reason,
-- client_request_id (optional). Returns the batch id.
create function public.adjust_stock(p jsonb) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_allowed constant text[] := array['batch_id','movement_type','quantity_delta','reason','client_request_id'];
  v_required constant text[] := array['batch_id','movement_type','quantity_delta','reason'];
  v_unknown text[];
  v_missing text[];
  v_batch public.medicine_batches%rowtype;
  v_batch_id uuid;
  v_type text;
  v_delta integer;
  v_reason text;
  v_request uuid;
  v_existing uuid;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'p must be a JSON object' using errcode = '22023';
  end if;
  select array_agg(k) into v_unknown from jsonb_object_keys(p) k where k <> all (v_allowed);
  if v_unknown is not null then
    raise exception 'unknown field(s): %', array_to_string(v_unknown, ', ') using errcode = '22023';
  end if;
  select array_agg(k) into v_missing from unnest(v_required) k
   where not (p ? k) or p -> k = 'null'::jsonb;
  if v_missing is not null then
    raise exception 'missing field(s): %', array_to_string(v_missing, ', ') using errcode = '22023';
  end if;

  v_batch_id := (p ->> 'batch_id')::uuid;
  v_type := p ->> 'movement_type';
  v_delta := (p ->> 'quantity_delta')::integer;
  v_reason := btrim(p ->> 'reason');
  v_request := (p ->> 'client_request_id')::uuid;

  if v_type not in ('ADJUSTMENT','DAMAGE','EXPIRED','CORRECTION') then
    raise exception 'movement_type % cannot be used for a manual adjustment', v_type using errcode = '22023';
  end if;
  if v_delta = 0 then
    raise exception 'quantity_delta must not be zero' using errcode = '23514';
  end if;
  if v_reason = '' then
    raise exception 'a reason is required' using errcode = '23514';
  end if;
  if v_type in ('DAMAGE','EXPIRED') and v_delta > 0 then
    raise exception '% removes stock' , v_type using errcode = '23514';
  end if;

  select * into v_batch from public.medicine_batches where id = v_batch_id for update;
  if not found then
    raise exception 'batch not found' using errcode = 'P0002';
  end if;
  perform public.require_permission(v_batch.branch_id, 'stock.adjust');

  -- A retried submit returns the first result instead of adjusting again.
  if v_request is not null then
    select m.batch_id into v_existing from public.stock_movements m
     where m.branch_id = v_batch.branch_id and m.client_request_id = v_request;
    if v_existing is not null then return v_existing; end if;
  end if;

  if v_type = 'EXPIRED' and v_batch.expiry_date > public.branch_today(v_batch.branch_id) then
    raise exception 'batch has not expired' using errcode = 'PH042';
  end if;
  if v_batch.quantity + v_delta < 0 then
    raise exception 'cannot remove % from a batch holding %', -v_delta, v_batch.quantity using errcode = 'PH041';
  end if;

  update public.medicine_batches set quantity = quantity + v_delta where id = v_batch.id;
  insert into public.stock_movements
    (branch_id, medicine_id, batch_id, quantity_delta, movement_type,
     reference_type, reference_id, reason, user_id, client_request_id)
  values
    (v_batch.branch_id, v_batch.medicine_id, v_batch.id, v_delta, v_type,
     'adjustment', v_batch.id::text, v_reason, auth.uid(), v_request);

  return v_batch.id;
end $$;

-- Write expired stock off the shelf: one EXPIRED movement per batch, atomically.
-- Returns the units written off. Every listed batch must be in the branch and expired.
create function public.write_off_expired(
  p_branch uuid,
  p_batch_ids uuid[],
  p_reason text default 'Expired stock written off'
) returns integer
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_today date;
  v_found integer;
  v_total integer := 0;
  v_reason text := coalesce(nullif(btrim(p_reason), ''), 'Expired stock written off');
  b record;
begin
  perform public.require_permission(p_branch, 'stock.adjust');
  if p_batch_ids is null or cardinality(p_batch_ids) = 0 then
    raise exception 'choose at least one batch' using errcode = '22023';
  end if;
  v_today := public.branch_today(p_branch);

  select count(*) into v_found from public.medicine_batches
   where id = any (p_batch_ids) and branch_id = p_branch;
  if v_found <> (select count(distinct x) from unnest(p_batch_ids) x) then
    raise exception 'one or more batches were not found' using errcode = 'P0002';
  end if;

  for b in
    select * from public.medicine_batches
     where id = any (p_batch_ids) and branch_id = p_branch
     order by id
     for update
  loop
    if b.expiry_date > v_today then
      raise exception 'batch % has not expired', b.batch_number using errcode = 'PH042';
    end if;
    continue when b.quantity = 0;

    update public.medicine_batches set quantity = 0 where id = b.id;
    insert into public.stock_movements
      (branch_id, medicine_id, batch_id, quantity_delta, movement_type,
       reference_type, reference_id, reason, user_id)
    values
      (b.branch_id, b.medicine_id, b.id, -b.quantity, 'EXPIRED',
       'write_off', b.id::text, v_reason, auth.uid());
    v_total := v_total + b.quantity;
  end loop;

  if v_total = 0 then
    raise exception 'there is no expired stock to write off' using errcode = 'PH043';
  end if;
  return v_total;
end $$;

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------

-- Stock per medicine. "Sellable" counts unexpired batches only; a batch dated today
-- is expired. p_filter: all | in_stock | low | out | expiring | expired.
--   low      reorder level is set and sellable stock is at or below it
--   out      no sellable stock but the medicine has been stocked before
--   expiring sellable stock whose nearest batch expires within p_days
create function public.list_stock(
  p_branch uuid,
  p_query text default '',
  p_filter text default 'all',
  p_days integer default 90,
  p_limit integer default 25,
  p_offset integer default 0
) returns table (
  medicine_id uuid,
  name text,
  generic_name text,
  company_name text,
  strength text,
  dosage_form text,
  unit text,
  reorder_level integer,
  is_active boolean,
  sellable_qty integer,
  expired_qty integer,
  batch_count integer,
  nearest_expiry date,
  nearest_expiry_days integer,
  value_at_cost numeric,
  total_count bigint
)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_raw text := btrim(coalesce(p_query, ''));
  v_pat text := replace(replace(replace(btrim(coalesce(p_query, '')), '\', '\\'), '%', '\%'), '_', '\_');
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_days integer := least(greatest(coalesce(p_days, 90), 1), 365);
  v_today date;
  v_cost boolean;
begin
  perform public.require_permission(p_branch, 'stock.view');
  if p_filter not in ('all','in_stock','low','out','expiring','expired') then
    raise exception 'unknown filter %', p_filter using errcode = '22023';
  end if;
  v_today := public.branch_today(p_branch);
  v_cost := public.has_permission(p_branch, 'purchase.view_cost');

  return query
  with agg as (
    select b.medicine_id as mid,
           coalesce(sum(b.quantity) filter (where b.expiry_date > v_today), 0)::integer as sellable,
           coalesce(sum(b.quantity) filter (where b.expiry_date <= v_today), 0)::integer as expired,
           (count(*) filter (where b.quantity > 0))::integer as live_batches,
           count(*) as ever_batches,
           min(b.expiry_date) filter (where b.quantity > 0 and b.expiry_date > v_today) as nearest,
           sum(b.quantity * b.purchase_price) as val
    from public.medicine_batches b
    where b.branch_id = p_branch
    group by b.medicine_id
  ),
  base as (
    select m.id, m.name, m.generic_name, c.name as company_name, m.strength, m.dosage_form,
           m.unit, m.reorder_level, m.is_active,
           coalesce(a.sellable, 0) as sellable, coalesce(a.expired, 0) as expired,
           coalesce(a.live_batches, 0) as live_batches, coalesce(a.ever_batches, 0) as ever_batches,
           a.nearest, a.val
    from public.medicines m
    left join public.companies c on c.id = m.company_id
    left join agg a on a.mid = m.id
    where (m.is_active or coalesce(a.sellable, 0) + coalesce(a.expired, 0) > 0)
      and (
        v_raw = ''
        or m.barcode = v_raw
        or lower(m.sku) = lower(v_raw)
        or m.name ilike '%' || v_pat || '%'
        or m.generic_name ilike '%' || v_pat || '%'
        or m.brand_name ilike '%' || v_pat || '%'
        or c.name ilike '%' || v_pat || '%'
      )
  ),
  filtered as (
    select * from base f
    where case p_filter
      when 'all'      then true
      when 'in_stock' then f.sellable > 0
      when 'low'      then f.reorder_level > 0 and f.sellable <= f.reorder_level
      when 'out'      then f.sellable = 0 and f.ever_batches > 0
      when 'expiring' then f.nearest is not null and f.nearest <= v_today + v_days
      when 'expired'  then f.expired > 0
    end
  )
  select f.id, f.name, f.generic_name, f.company_name, f.strength, f.dosage_form, f.unit,
         f.reorder_level, f.is_active, f.sellable, f.expired, f.live_batches::integer,
         f.nearest, (f.nearest - v_today)::integer,
         case when v_cost then f.val end,
         count(*) over ()
  from filtered f
  order by lower(f.name), f.id
  limit v_limit offset v_offset;
end $$;

-- Headline numbers for the inventory page and the dashboard.
create function public.inventory_summary(p_branch uuid)
returns table (
  stocked_medicines integer,
  sellable_units bigint,
  low_stock_count integer,
  out_of_stock_count integer,
  expiring_30_batches integer,
  expired_batches integer,
  expired_units bigint,
  value_at_cost numeric,
  expired_value_at_cost numeric
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
  with agg as (
    select b.medicine_id as mid,
           coalesce(sum(b.quantity) filter (where b.expiry_date > v_today), 0) as sellable,
           coalesce(sum(b.quantity) filter (where b.expiry_date <= v_today), 0) as expired,
           count(*) as ever_batches
    from public.medicine_batches b
    where b.branch_id = p_branch
    group by b.medicine_id
  ),
  -- Same population as list_stock, so the two always agree.
  per_med as (
    select m.reorder_level,
           coalesce(a.sellable, 0) as sellable,
           coalesce(a.ever_batches, 0) as ever_batches
    from public.medicines m
    left join agg a on a.mid = m.id
    where m.is_active or coalesce(a.sellable, 0) + coalesce(a.expired, 0) > 0
  ),
  batch_totals as (
    select
      (count(*) filter (where b.quantity > 0 and b.expiry_date > v_today
                         and b.expiry_date <= v_today + 30))::integer as exp30,
      (count(*) filter (where b.quantity > 0 and b.expiry_date <= v_today))::integer as exp_batches,
      coalesce(sum(b.quantity) filter (where b.expiry_date <= v_today), 0) as exp_units,
      sum(b.quantity * b.purchase_price) as val,
      sum(b.quantity * b.purchase_price) filter (where b.expiry_date <= v_today) as exp_val
    from public.medicine_batches b
    where b.branch_id = p_branch
  )
  select
    (select count(*) from per_med where sellable > 0)::integer,
    (select coalesce(sum(sellable), 0) from per_med)::bigint,
    (select count(*) from per_med where reorder_level > 0 and sellable <= reorder_level)::integer,
    (select count(*) from per_med where sellable = 0 and ever_batches > 0)::integer,
    t.exp30, t.exp_batches, t.exp_units::bigint,
    case when v_cost then coalesce(t.val, 0) end,
    case when v_cost then coalesce(t.exp_val, 0) end
  from batch_totals t;
end $$;

-- Batches with stock, grouped by how soon they expire (or already expired).
-- p_bucket: all | expired | d30 | d60 | d90.  "all" is expired plus the next 90 days.
create function public.list_expiry(
  p_branch uuid,
  p_bucket text default 'all',
  p_limit integer default 25,
  p_offset integer default 0
) returns table (
  batch_id uuid,
  medicine_id uuid,
  medicine_name text,
  strength text,
  batch_number text,
  expiry_date date,
  days_to_expiry integer,
  quantity integer,
  value_at_cost numeric,
  total_count bigint
)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_today date;
  v_cost boolean;
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  perform public.require_permission(p_branch, 'stock.view');
  if p_bucket not in ('all','expired','d30','d60','d90') then
    raise exception 'unknown bucket %', p_bucket using errcode = '22023';
  end if;
  v_today := public.branch_today(p_branch);
  v_cost := public.has_permission(p_branch, 'purchase.view_cost');

  return query
  select b.id, m.id, m.name, m.strength, b.batch_number, b.expiry_date,
         (b.expiry_date - v_today)::integer, b.quantity,
         case when v_cost then b.quantity * b.purchase_price end,
         count(*) over ()
  from public.medicine_batches b
  join public.medicines m on m.id = b.medicine_id
  where b.branch_id = p_branch
    and b.quantity > 0
    and case p_bucket
      when 'all'     then b.expiry_date <= v_today + 90
      when 'expired' then b.expiry_date <= v_today
      when 'd30'     then b.expiry_date > v_today and b.expiry_date <= v_today + 30
      when 'd60'     then b.expiry_date > v_today + 30 and b.expiry_date <= v_today + 60
      when 'd90'     then b.expiry_date > v_today + 60 and b.expiry_date <= v_today + 90
    end
  order by b.expiry_date, lower(m.name), b.id
  limit v_limit offset v_offset;
end $$;

-- Counts and value per bucket, for the tabs on the expiry page.
create function public.expiry_buckets(p_branch uuid)
returns table (bucket text, batch_count integer, units bigint, value_at_cost numeric)
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
  with live as (
    select b.*,
           case
             when b.expiry_date <= v_today then 'expired'
             when b.expiry_date <= v_today + 30 then 'd30'
             when b.expiry_date <= v_today + 60 then 'd60'
             when b.expiry_date <= v_today + 90 then 'd90'
           end as bk
    from public.medicine_batches b
    where b.branch_id = p_branch and b.quantity > 0
  )
  select k.bucket,
         (count(l.id))::integer,
         coalesce(sum(l.quantity), 0)::bigint,
         case when v_cost then coalesce(sum(l.quantity * l.purchase_price), 0) end
  from (values ('expired'), ('d30'), ('d60'), ('d90')) k(bucket)
  left join live l on l.bk = k.bucket
  group by k.bucket
  order by array_position(array['expired','d30','d60','d90'], k.bucket);
end $$;

-- Movement history, newest first. Page with p_before = the last id of the previous
-- page (keyset paging stays fast however large the table grows).
create function public.list_stock_movements(
  p_branch uuid,
  p_medicine uuid default null,
  p_batch uuid default null,
  p_type text default null,
  p_before bigint default null,
  p_limit integer default 50
) returns table (
  id bigint,
  created_at timestamptz,
  movement_type text,
  quantity_delta integer,
  reason text,
  reference_type text,
  reference_id text,
  medicine_id uuid,
  medicine_name text,
  batch_id uuid,
  batch_number text,
  user_name text
)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 101);
begin
  perform public.require_permission(p_branch, 'stock.view');
  if p_type is not null and p_type not in (
    'PURCHASE','SALE','SALE_RETURN','PURCHASE_RETURN','ADJUSTMENT',
    'DAMAGE','EXPIRED','TRANSFER','OPENING_STOCK','CORRECTION') then
    raise exception 'unknown movement type %', p_type using errcode = '22023';
  end if;

  return query
  select sm.id, sm.created_at, sm.movement_type, sm.quantity_delta, sm.reason,
         sm.reference_type, sm.reference_id,
         sm.medicine_id, m.name, sm.batch_id, b.batch_number,
         nullif(btrim(p.full_name), '')
  from public.stock_movements sm
  join public.medicines m on m.id = sm.medicine_id
  join public.medicine_batches b on b.id = sm.batch_id
  left join public.profiles p on p.id = sm.user_id
  where sm.branch_id = p_branch
    and (p_medicine is null or sm.medicine_id = p_medicine)
    and (p_batch is null or sm.batch_id = p_batch)
    and (p_type is null or sm.movement_type = p_type)
    and (p_before is null or sm.id < p_before)
  order by sm.id desc
  limit v_limit;
end $$;

-- Integrity check: batches whose quantity disagrees with their movements. The
-- commit-time invariant should keep this empty; a row here means something
-- bypassed it and needs investigation, never a silent "fix".
create function public.stock_reconciliation(p_branch uuid)
returns table (batch_id uuid, medicine_id uuid, batch_number text, quantity integer, movement_sum bigint, drift bigint)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_permission(p_branch, 'audit.view');
  return query
  select b.id, b.medicine_id, b.batch_number, b.quantity,
         coalesce(s.total, 0)::bigint,
         (b.quantity - coalesce(s.total, 0))::bigint
  from public.medicine_batches b
  left join (
    select sm.batch_id as bid, sum(sm.quantity_delta) as total
    from public.stock_movements sm
    where sm.branch_id = p_branch
    group by sm.batch_id
  ) s on s.bid = b.id
  where b.branch_id = p_branch
    and b.quantity <> coalesce(s.total, 0)
  order by b.id;
end $$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on function public.adjust_stock(jsonb) from public;
revoke all on function public.write_off_expired(uuid, uuid[], text) from public;
revoke all on function public.list_stock(uuid, text, text, integer, integer, integer) from public;
revoke all on function public.inventory_summary(uuid) from public;
revoke all on function public.list_expiry(uuid, text, integer, integer) from public;
revoke all on function public.expiry_buckets(uuid) from public;
revoke all on function public.list_stock_movements(uuid, uuid, uuid, text, bigint, integer) from public;
revoke all on function public.stock_reconciliation(uuid) from public;

grant execute on function public.adjust_stock(jsonb) to authenticated;
grant execute on function public.write_off_expired(uuid, uuid[], text) to authenticated;
grant execute on function public.list_stock(uuid, text, text, integer, integer, integer) to authenticated;
grant execute on function public.inventory_summary(uuid) to authenticated;
grant execute on function public.list_expiry(uuid, text, integer, integer) to authenticated;
grant execute on function public.expiry_buckets(uuid) to authenticated;
grant execute on function public.list_stock_movements(uuid, uuid, uuid, text, bigint, integer) to authenticated;
grant execute on function public.stock_reconciliation(uuid) to authenticated;
