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

select t.owner();
rollback;
