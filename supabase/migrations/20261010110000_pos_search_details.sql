-- POS search returns enough catalogue details for a quick barcode confirmation.
-- The barcode must be associated with a catalogue record; no price is guessed.
drop function if exists public.pos_search(uuid, text, integer);

create function public.pos_search(p_branch uuid, p_query text default '', p_limit integer default 20)
returns table (
  id uuid, name text, generic_name text, brand_name text, strength text,
  dosage_form text, unit text, pack_size integer, company_name text,
  barcode text, sku text, prescription_required boolean,
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
  select h.id, h.name, h.generic_name, h.brand_name, h.strength,
         h.dosage_form, h.unit, h.pack_size, h.company_name, h.barcode, h.sku,
         h.prescription_required, first_batch.sale_price,
         coalesce(first_batch.mrp, h.mrp),
         coalesce(stock.qty, 0)::integer,
         coalesce(stock.batches, 0)::integer,
         first_batch.expiry_date, h.is_exact
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

revoke all on function public.pos_search(uuid, text, integer) from public;
grant execute on function public.pos_search(uuid, text, integer) to authenticated;
