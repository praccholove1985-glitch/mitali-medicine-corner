-- Scale check: 10,000 medicines and 20,000 batches. Prints timings and fails if a
-- search takes longer than the budget. The budget is deliberately loose (CI
-- machines vary); the printed figures are what to watch.
begin;

insert into public.companies (name)
select 'Company ' || g from generate_series(1, 60) g;

insert into public.medicines (name, generic_name, brand_name, company_id, strength, barcode, sku, mrp, default_sale_price)
select
  (array['Napa','Ace','Zimax','Seclo','Maxpro','Fexo','Monas','Rolac','Ceevit','Tofen'])[1 + g % 10] || ' ' || (100 + g % 900) || 'mg ' || g,
  (array['Paracetamol','Azithromycin','Omeprazole','Esomeprazole','Fexofenadine','Montelukast','Ketorolac','Ascorbic acid','Ketotifen','Cetirizine'])[1 + g % 10],
  (array['Napa','Ace','Zimax','Seclo','Maxpro','Fexo','Monas','Rolac','Ceevit','Tofen'])[1 + g % 10],
  (select id from public.companies order by name offset g % 60 limit 1),
  (100 + g % 900) || 'mg',
  '890' || lpad(g::text, 10, '0'),
  'SKU-' || lpad(g::text, 6, '0'),
  5, 4
from generate_series(1, 10000) g;

insert into public.medicine_batches (branch_id, medicine_id, batch_number, expiry_date, purchase_price, sale_price, mrp, quantity)
select 'aaaaaaaa-0000-0000-0000-000000000001', m.id, 'L' || b, current_date + 30 + (b * 90), 3, 4, 5, 10 * b
from (select id from public.medicines) m, generate_series(1, 2) b;

insert into public.stock_movements (branch_id, medicine_id, batch_id, quantity_delta, movement_type, reference_type, reference_id, reason)
select branch_id, medicine_id, id, quantity, 'OPENING_STOCK', 'batch', id::text, 'seed'
from public.medicine_batches;

analyze public.medicines;
analyze public.companies;
analyze public.medicine_batches;

select t.login('a4000000-0000-0000-0000-000000000001');

do $$
declare
  v_t timestamptz;
  v_ms numeric;
  v_n bigint;
  v_budget constant numeric := 250;
  r record;
begin
  for r in
    select * from (values
      ('first page, no query',        ''),
      ('name prefix "nap"',           'nap'),
      ('contains "cetam"',            'cetam'),
      ('generic "omeprazole"',        'omeprazole'),
      ('company "company 17"',        'company 17'),
      ('exact barcode',               '8900000004242'),
      ('exact SKU',                   'sku-004242'),
      ('no match',                    'zzzzqq')
    ) q(label, term)
  loop
    v_t := clock_timestamp();
    select count(*) into v_n from public.search_medicines('aaaaaaaa-0000-0000-0000-000000000001', r.term, 25, 0);
    v_ms := round(extract(epoch from clock_timestamp() - v_t) * 1000, 1);
    raise notice 'perf: % -> % rows in % ms', rpad(r.label, 26), v_n, v_ms;
    if v_ms > v_budget then
      raise exception 'FAIL: search "%" took % ms (budget % ms)', r.term, v_ms, v_budget;
    end if;
  end loop;
end $$;

-- Inventory reads over the same data (as the manager, so cost is included).
select t.owner();
select t.login('a2000000-0000-0000-0000-000000000001');

do $$
declare
  v_t timestamptz;
  v_ms numeric;
  v_n bigint;
  v_budget constant numeric := 400;
  r record;
begin
  for r in
    select * from (values
      ('stock list: in stock',   'select count(*) from public.list_stock(''aaaaaaaa-0000-0000-0000-000000000001'', '''', ''in_stock'', 90, 25, 0)'),
      ('stock list: low',        'select count(*) from public.list_stock(''aaaaaaaa-0000-0000-0000-000000000001'', '''', ''low'', 90, 25, 0)'),
      ('stock list: expiring',   'select count(*) from public.list_stock(''aaaaaaaa-0000-0000-0000-000000000001'', '''', ''expiring'', 90, 25, 0)'),
      ('stock list: searched',   'select count(*) from public.list_stock(''aaaaaaaa-0000-0000-0000-000000000001'', ''omepra'', ''all'', 90, 25, 0)'),
      ('inventory summary',      'select count(*) from public.inventory_summary(''aaaaaaaa-0000-0000-0000-000000000001'')'),
      ('expiry buckets',         'select count(*) from public.expiry_buckets(''aaaaaaaa-0000-0000-0000-000000000001'')'),
      ('expiry list',            'select count(*) from public.list_expiry(''aaaaaaaa-0000-0000-0000-000000000001'', ''all'', 25, 0)'),
      ('movements: newest 50',   'select count(*) from public.list_stock_movements(''aaaaaaaa-0000-0000-0000-000000000001'')'),
      ('reconciliation',         'select count(*) from public.stock_reconciliation(''aaaaaaaa-0000-0000-0000-000000000001'')')
    ) q(label, stmt)
  loop
    v_t := clock_timestamp();
    execute r.stmt into v_n;
    v_ms := round(extract(epoch from clock_timestamp() - v_t) * 1000, 1);
    raise notice 'perf: % -> % rows in % ms', rpad(r.label, 26), v_n, v_ms;
    if v_ms > v_budget then
      raise exception 'FAIL: % took % ms (budget % ms)', r.label, v_ms, v_budget;
    end if;
  end loop;
end $$;

-- The till: search, quote and a 20-line sale, as a cashier.
select t.owner();
select t.login('a4000000-0000-0000-0000-000000000001');

do $$
declare
  v_t timestamptz;
  v_ms numeric;
  v_items jsonb;
  v_quote jsonb;
  v_invoice jsonb;
  v_budget constant numeric := 400;
  r record;
begin
  select jsonb_agg(jsonb_build_object('medicine_id', m.id, 'quantity', 2)) into v_items
    from (select id from public.medicines order by id limit 20) m;

  for r in
    select * from (values
      ('pos_search: 2 letters',   'select count(*) from public.pos_search(''aaaaaaaa-0000-0000-0000-000000000001'', ''na'', 20)'),
      ('pos_search: barcode',     'select count(*) from public.pos_search(''aaaaaaaa-0000-0000-0000-000000000001'', ''8900000004242'', 20)'),
      ('pos_search: word',        'select count(*) from public.pos_search(''aaaaaaaa-0000-0000-0000-000000000001'', ''omeprazole'', 20)')
    ) q(label, stmt)
  loop
    v_t := clock_timestamp();
    execute r.stmt;
    v_ms := round(extract(epoch from clock_timestamp() - v_t) * 1000, 1);
    raise notice 'perf: % -> % ms', rpad(r.label, 26), v_ms;
    if v_ms > v_budget then raise exception 'FAIL: % took % ms (budget % ms)', r.label, v_ms, v_budget; end if;
  end loop;

  v_t := clock_timestamp();
  v_quote := public.quote_sale('aaaaaaaa-0000-0000-0000-000000000001', v_items);
  v_ms := round(extract(epoch from clock_timestamp() - v_t) * 1000, 1);
  raise notice 'perf: % -> % ms', rpad('quote_sale: 20 lines', 26), v_ms;
  if v_ms > v_budget then raise exception 'FAIL: quote took % ms', v_ms; end if;

  v_t := clock_timestamp();
  v_invoice := public.complete_sale(jsonb_build_object(
    'branch_id', 'aaaaaaaa-0000-0000-0000-000000000001', 'client_request_id', gen_random_uuid(),
    'items', v_items,
    'payments', jsonb_build_array(jsonb_build_object('method', 'CASH', 'amount', v_quote -> 'totals' ->> 'grand_total'))));
  v_ms := round(extract(epoch from clock_timestamp() - v_t) * 1000, 1);
  raise notice 'perf: % -> % ms', rpad('complete_sale: 20 lines', 26), v_ms;
  if v_ms > v_budget then raise exception 'FAIL: complete_sale took % ms', v_ms; end if;
  if (v_invoice -> 'totals' ->> 'grand_total') <> (v_quote -> 'totals' ->> 'grand_total') then
    raise exception 'FAIL: invoice total differs from the quote';
  end if;
end $$;

select t.owner();
rollback;
