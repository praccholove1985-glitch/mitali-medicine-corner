-- Point of sale: FEFO, pricing and rounding, discounts, payments, credit, atomicity,
-- idempotency, invoices and history. Money values are checked as exact decimals.
begin;

create temp table ids (k text primary key, v uuid) on commit drop;
grant all on ids to authenticated;

-- ---- fixtures ---------------------------------------------------------------------------
insert into public.medicines (id, name, tax_rate, prescription_required, barcode, sku) values
  ('d1000000-0000-0000-0000-000000000001', 'Napa',     0, false, '8901111111111', 'NAPA'),
  ('d2000000-0000-0000-0000-000000000001', 'Taxed',    5, false, null, null),
  ('d3000000-0000-0000-0000-000000000001', 'Pricey',   0, false, null, null),
  ('d4000000-0000-0000-0000-000000000001', 'Hundred',  0, false, null, null),
  ('d5000000-0000-0000-0000-000000000001', 'RxOnly',   0, true,  null, null),
  ('d6000000-0000-0000-0000-000000000001', 'RoundUp',  0, false, null, null),
  ('d7000000-0000-0000-0000-000000000001', 'RoundDn',  0, false, null, null);

select t.login('a3000000-0000-0000-0000-000000000001'); -- pharmacist creates stock
create function pg_temp.mk(p_key text, p_med text, p_batch text, p_days integer, p_qty integer, p_cost text, p_price text, p_branch text default 'aaaaaaaa-0000-0000-0000-000000000001') returns void
language plpgsql as $f$
begin
  insert into ids values (p_key, public.create_batch(jsonb_build_object(
    'branch_id', p_branch::uuid, 'medicine_id', p_med::uuid,
    'batch_number', p_batch, 'expiry_date', (current_date + p_days)::text,
    'purchase_price', p_cost, 'sale_price', p_price, 'quantity', p_qty)));
end $f$;
grant execute on function pg_temp.mk(text, text, text, integer, integer, text, text, text) to authenticated;

select pg_temp.mk('na', 'd1000000-0000-0000-0000-000000000001', 'A', 200, 40,  '1.10', '1.50');   -- the brief's example
select pg_temp.mk('nb', 'd1000000-0000-0000-0000-000000000001', 'B', 400, 100, '1.20', '1.50');
select pg_temp.mk('tx', 'd2000000-0000-0000-0000-000000000001', 'T', 300, 100, '0.80', '1.125');
select pg_temp.mk('p1', 'd3000000-0000-0000-0000-000000000001', 'P1', 100, 3,   '60.00', '100.00');
select pg_temp.mk('p2', 'd3000000-0000-0000-0000-000000000001', 'P2', 200, 10,  '70.00', '120.00');
select pg_temp.mk('h1', 'd4000000-0000-0000-0000-000000000001', 'H', 300, 50,  '60.00', '100.00');
select pg_temp.mk('rx', 'd5000000-0000-0000-0000-000000000001', 'R', 300, 20,  '6.00',  '10.00');
select pg_temp.mk('ru', 'd6000000-0000-0000-0000-000000000001', 'RU', 300, 10, '0.0010', '1.0050');
select pg_temp.mk('rd', 'd7000000-0000-0000-0000-000000000001', 'RD', 300, 10, '0.0010', '1.0049');
select t.owner();

insert into public.customers (id, branch_id, name, phone, credit_limit) values
  ('c1000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Rahim', '01711111111', 500),
  ('c2000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'No Limit', '01722222222', null),
  ('c3000000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'Branch B customer', null, null);
set constraints all immediate;
select t.ok(true, 'fixtures satisfy the stock invariant');
set constraints all deferred;

-- helpers
create function pg_temp.line(p_med text, p_qty integer, p_dtype text default null, p_dvalue text default null, p_batch uuid default null) returns jsonb
language sql as $f$
  select jsonb_strip_nulls(jsonb_build_object('medicine_id', p_med, 'quantity', p_qty,
    'discount_type', p_dtype, 'discount_value', p_dvalue, 'batch_id', p_batch))
$f$;
grant execute on function pg_temp.line(text, integer, text, text, uuid) to authenticated;

create function pg_temp.sell(p_items jsonb, p_payments jsonb, p_customer uuid default null, p_request uuid default gen_random_uuid(), p_branch text default 'aaaaaaaa-0000-0000-0000-000000000001') returns jsonb
language sql as $f$
  select public.complete_sale(jsonb_strip_nulls(jsonb_build_object(
    'branch_id', p_branch::uuid, 'client_request_id', p_request, 'customer_id', p_customer,
    'items', p_items, 'payments', p_payments)))
$f$;
grant execute on function pg_temp.sell(jsonb, jsonb, uuid, uuid, text) to authenticated;

create function pg_temp.qty(p_key text) returns integer language sql as
$f$ select quantity from public.medicine_batches where id = (select v from ids where k = p_key) $f$;

-- ---- permissions ---------------------------------------------------------------------------
select t.anon();
select t.throws('select public.pos_search(''aaaaaaaa-0000-0000-0000-000000000001'', ''napa'')', '42501', 'anon cannot search at the till');
select t.throws('select public.complete_sale(''{}''::jsonb)', '42501', 'anon cannot complete a sale');
select t.owner();

select t.login('c0000000-0000-0000-0000-000000000001'); -- no membership
select t.throws(format('select pg_temp.sell(jsonb_build_array(pg_temp.line(%L, 1)), ''[{"method":"CASH","amount":"1.50"}]''::jsonb)', 'd1000000-0000-0000-0000-000000000001'),
  '42501', 'a user with no membership cannot sell');
select t.owner();

select t.login('b1000000-0000-0000-0000-000000000001'); -- admin of Branch B
select t.throws(format('select pg_temp.sell(jsonb_build_array(pg_temp.line(%L, 1)), ''[{"method":"CASH","amount":"1.50"}]''::jsonb)', 'd1000000-0000-0000-0000-000000000001'),
  '42501', 'admin B cannot sell in Branch A');
select t.throws('select * from public.pos_search(''aaaaaaaa-0000-0000-0000-000000000001'', ''napa'')', '42501', 'admin B cannot search Branch A at the till');
select t.owner();

-- ---- search and batch lookups ----------------------------------------------------------------
select t.login('a4000000-0000-0000-0000-000000000001'); -- cashier
select t.ok((select count(*) = 1 and bool_and(exact_match) and max(name) = 'Napa'
               from public.pos_search('aaaaaaaa-0000-0000-0000-000000000001', '8901111111111')), 'a barcode scan returns one exact match');
select t.ok((select exact_match from public.pos_search('aaaaaaaa-0000-0000-0000-000000000001', 'napa') where name = 'Napa') = true,
  'a SKU match (any case) is exact');
select t.ok((select exact_match from public.pos_search('aaaaaaaa-0000-0000-0000-000000000001', 'nap') where name = 'Napa') = false,
  'a partial name is not an exact match');
select t.ok((select sale_price = 1.50 and sellable_qty = 140 and batch_count = 2 and nearest_expiry = current_date + 200
               from public.pos_search('aaaaaaaa-0000-0000-0000-000000000001', 'napa') where name = 'Napa'),
  'search shows the FEFO batch price, total sellable stock and the nearest expiry');
select t.ok((select sale_price = 100.00 from public.pos_search('aaaaaaaa-0000-0000-0000-000000000001', 'pricey') where name = 'Pricey'),
  'the shown price is the first-to-sell batch price');
select t.ok((select count(*) from public.pos_search('aaaaaaaa-0000-0000-0000-000000000001', '_')) = 0, 'an underscore is searched literally');
select t.ok((select array_agg(batch_number order by expiry_date) = array['P1','P2'] from public.pos_batches('aaaaaaaa-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000001')),
  'pos_batches lists sellable batches in FEFO order');
select t.owner();

-- ---- FEFO and exact pricing -----------------------------------------------------------------
select t.login('a4000000-0000-0000-0000-000000000001');
insert into ids values ('inv1', (pg_temp.sell(
  jsonb_build_array(pg_temp.line('d1000000-0000-0000-0000-000000000001', 50)),
  '[{"method":"CASH","amount":"75.00"}]'::jsonb) ->> 'id')::uuid);
select t.owner();

select t.ok(pg_temp.qty('na') = 0 and pg_temp.qty('nb') = 90, 'FEFO: 50 units took all 40 of the earlier batch and 10 of the next');
select t.ok((select count(*) = 2 from public.sale_item_allocations a join public.sale_items i on i.id = a.sale_item_id
              where i.sale_id = (select v from ids where k = 'inv1')), 'a line that spans two batches has two allocations');
select t.ok((select string_agg(a.batch_number || ':' || a.quantity || '@' || a.unit_cost, ',' order by a.expiry_date)
               from public.sale_item_allocations a join public.sale_items i on i.id = a.sale_item_id where i.sale_id = (select v from ids where k = 'inv1'))
          = 'A:40@1.1000,B:10@1.2000', 'each allocation keeps its own batch cost');
select t.ok((select count(*) = 2 and sum(quantity_delta) = -50 and bool_and(movement_type = 'SALE' and reference_type = 'sale')
              and bool_and(reference_id = (select v::text from ids where k = 'inv1'))
               from public.stock_movements where reference_id = (select v::text from ids where k = 'inv1')),
  'every stock change created a SALE movement tied to the sale');
-- cost_total is hidden from plain reads, so check it as the owner
select t.ok((select s.grand_total = 75.00 and s.cost_total = 56.0000 and s.profit_total = 19.0000 and s.paid_total = 75.00 and s.due_total = 0
               from public.sales s where s.id = (select v from ids where k = 'inv1')),
  '50 x 1.50 = 75.00; cost 40 x 1.10 + 10 x 1.20 = 56.00; profit 19.00');
select t.ok((select invoice_no = 'INV-000001' from public.sales where id = (select v from ids where k = 'inv1')), 'the first invoice is INV-000001');

-- Historical cost: changing prices later must not move recorded profit.
update public.medicine_batches set purchase_price = 9.99, sale_price = 1.50 where id = (select v from ids where k = 'nb');
select t.ok((select s.profit_total = 19.0000 from public.sales s where s.id = (select v from ids where k = 'inv1')),
  'a later cost change does not alter recorded profit');
select t.ok((select unit_cost = 1.2000 from public.sale_item_allocations a join public.sale_items i on i.id = a.sale_item_id
              where i.sale_id = (select v from ids where k = 'inv1') and a.batch_number = 'B'), 'the snapshot keeps the cost at the time of sale');
update public.medicine_batches set purchase_price = 1.20 where id = (select v from ids where k = 'nb');

-- A different price per batch within one line.
select t.login('a4000000-0000-0000-0000-000000000001');
insert into ids values ('inv2', (pg_temp.sell(
  jsonb_build_array(pg_temp.line('d3000000-0000-0000-0000-000000000001', 5)),
  '[{"method":"CASH","amount":"540.00"}]'::jsonb) ->> 'id')::uuid);
select t.owner();
select t.ok((select s.grand_total = 540.00 and s.cost_total = 320.0000 and s.profit_total = 220.0000 from public.sales s where s.id = (select v from ids where k = 'inv2')),
  '5 units over two batches: 3 x 100 + 2 x 120 = 540; cost 3 x 60 + 2 x 70 = 320; profit 220');
select t.ok(pg_temp.qty('p1') = 0 and pg_temp.qty('p2') = 8, 'quantities after the two-price sale');

-- Rounding: half up, once per line.
select t.login('a4000000-0000-0000-0000-000000000001');
insert into ids values ('sale_ru', (pg_temp.sell(jsonb_build_array(pg_temp.line('d6000000-0000-0000-0000-000000000001', 1)), '[{"method":"CASH","amount":"1.01"}]'::jsonb) ->> 'id')::uuid);
select t.throws(format('select pg_temp.sell(jsonb_build_array(pg_temp.line(%L, 1)), ''[{"method":"CASH","amount":"1.01"}]''::jsonb)', 'd7000000-0000-0000-0000-000000000001'),
  'PH051', '1.0049 rounds down to 1.00, so paying 1.01 is a mismatch');
insert into ids values ('sale_rd', (pg_temp.sell(jsonb_build_array(pg_temp.line('d7000000-0000-0000-0000-000000000001', 1)), '[{"method":"CASH","amount":"1.00"}]'::jsonb) ->> 'id')::uuid);
select t.owner();
select t.ok((select grand_total = 1.01 from public.sales where id = (select v from ids where k = 'sale_ru')), '1.0050 rounds half up to 1.01');
select t.ok((select grand_total = 1.00 from public.sales where id = (select v from ids where k = 'sale_rd')), '1.0049 rounds to 1.00');

-- Tax (VAT included) and a percentage discount: the 3 x 1.125 worked example.
select t.login('a2000000-0000-0000-0000-000000000001'); -- manager: may discount above the limit
insert into ids values ('inv3', (pg_temp.sell(
  jsonb_build_array(pg_temp.line('d2000000-0000-0000-0000-000000000001', 3, 'PERCENT', '10')),
  '[{"method":"BKASH","amount":"3.04","reference":"TX123"}]'::jsonb) ->> 'id')::uuid);
select t.owner();
select t.ok((select i.gross = 3.38 and i.discount = 0.34 and i.line_total = 3.04 and i.tax_amount = 0.14 and i.cost_total = 2.4000 and i.profit = 0.5000
               from public.sale_items i where i.sale_id = (select v from ids where k = 'inv3')),
  '3 x 1.125 = 3.375 -> 3.38; 10% off = 0.34 -> 3.04; VAT 5% inside = 0.14; profit = 3.04 - 0.14 - 2.40 = 0.50');
select t.ok((select reference = 'TX123' and method = 'BKASH' from public.payments where sale_id = (select v from ids where k = 'inv3')), 'the payment reference is kept');

-- ---- explicit batch choice and expired stock ---------------------------------------------------
select t.login('a4000000-0000-0000-0000-000000000001');
insert into ids values ('inv4', (pg_temp.sell(
  jsonb_build_array(pg_temp.line('d1000000-0000-0000-0000-000000000001', 3, null, null, (select v from ids where k = 'nb'))),
  '[{"method":"CASH","amount":"4.50"}]'::jsonb) ->> 'id')::uuid);
select t.ok(pg_temp.qty('nb') = 87, 'a chosen batch is sold from exactly that batch');
select t.throws(format('select pg_temp.sell(jsonb_build_array(pg_temp.line(%L, 100, null, null, %L)), ''[{"method":"CASH","amount":"150.00"}]''::jsonb)',
  'd1000000-0000-0000-0000-000000000001', (select v from ids where k = 'nb')), 'PH001', 'a chosen batch with too little stock fails; it does not spill into another batch');
select t.throws(format('select pg_temp.sell(jsonb_build_array(pg_temp.line(%L, 1, null, null, %L)), ''[{"method":"CASH","amount":"1.50"}]''::jsonb)',
  'd1000000-0000-0000-0000-000000000001', (select v from ids where k = 'p1')), 'PH044', 'a batch of another medicine cannot be chosen');
select t.owner();

-- The earlier batch is now empty. Make the remaining one expire today: nothing is sellable.
update public.medicine_batches set expiry_date = (now() at time zone 'Asia/Dhaka')::date where id = (select v from ids where k = 'nb');
select t.login('a4000000-0000-0000-0000-000000000001');
select t.throws(format('select pg_temp.sell(jsonb_build_array(pg_temp.line(%L, 1)), ''[{"method":"CASH","amount":"1.50"}]''::jsonb)', 'd1000000-0000-0000-0000-000000000001'),
  'PH001', 'a batch expiring today is expired: it cannot be sold');
select t.throws(format('select pg_temp.sell(jsonb_build_array(pg_temp.line(%L, 1, null, null, %L)), ''[{"method":"CASH","amount":"1.50"}]''::jsonb)', 'd1000000-0000-0000-0000-000000000001', (select v from ids where k = 'nb')),
  'PH044', 'an expired batch cannot be chosen explicitly either');
select t.ok((select sellable_qty = 0 from public.pos_search('aaaaaaaa-0000-0000-0000-000000000001', 'napa') where name = 'Napa'), 'search no longer counts expired stock');
select t.ok((select count(*) = 0 from public.pos_batches('aaaaaaaa-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001')), 'the batch picker no longer lists it');
select t.owner();
select t.ok(pg_temp.qty('nb') = 87, 'the refused sales changed nothing');

-- ---- discounts, below cost, prescription ----------------------------------------------------------
select t.login('a4000000-0000-0000-0000-000000000001'); -- cashier: 5% limit by default
select t.throws(format('select pg_temp.sell(jsonb_build_array(pg_temp.line(%L, 2, ''PERCENT'', ''6'')), ''[{"method":"CASH","amount":"1"}]''::jsonb)', 'd4000000-0000-0000-0000-000000000001'),
  'PH052', 'a 6 percent discount is above the cashier limit');
select t.throws(format('select pg_temp.sell(jsonb_build_array(pg_temp.line(%L, 2, ''AMOUNT'', ''12'')), ''[{"method":"CASH","amount":"1"}]''::jsonb)', 'd4000000-0000-0000-0000-000000000001'),
  'PH052', 'a 12.00 discount on 200.00 (6 percent) is above the limit too');
select t.throws(format('select pg_temp.sell(jsonb_build_array(pg_temp.line(%L, 2, ''AMOUNT'', ''201'')), ''[{"method":"CASH","amount":"1"}]''::jsonb)', 'd4000000-0000-0000-0000-000000000001'),
  'PH050', 'a discount larger than the line is invalid');
select t.throws(format('select pg_temp.sell(jsonb_build_array(pg_temp.line(%L, 2, ''PERCENT'', ''101'')), ''[{"method":"CASH","amount":"1"}]''::jsonb)', 'd4000000-0000-0000-0000-000000000001'),
  'PH050', 'a discount over 100 percent is invalid');
select t.throws(format('select pg_temp.sell(jsonb_build_array(pg_temp.line(%L, 2, ''AMOUNT'', ''-1'')), ''[{"method":"CASH","amount":"1"}]''::jsonb)', 'd4000000-0000-0000-0000-000000000001'),
  'PH050', 'a negative discount is invalid');
select t.throws(format('select pg_temp.sell(jsonb_build_array(pg_temp.line(%L, 2, ''AMOUNT'', ''1.001'')), ''[{"method":"CASH","amount":"1"}]''::jsonb)', 'd4000000-0000-0000-0000-000000000001'),
  'PH050', 'a discount with three decimals is invalid');
select t.throws(format('select pg_temp.sell(jsonb_build_array(pg_temp.line(%L, 2, ''BOGUS'', ''1'')), ''[{"method":"CASH","amount":"1"}]''::jsonb)', 'd4000000-0000-0000-0000-000000000001'),
  '22023', 'an unknown discount type is invalid');
select pg_temp.sell(jsonb_build_array(pg_temp.line('d4000000-0000-0000-0000-000000000001', 2, 'PERCENT', '5')), '[{"method":"CASH","amount":"190.00"}]'::jsonb);
select t.ok(true, 'exactly 5 percent is allowed for a cashier');
-- Below cost: 60.00 cost, selling at 100 less a 5% discount is fine; make a free item.
select t.owner();

select t.login('a2000000-0000-0000-0000-000000000001'); -- manager has sale.discount
select pg_temp.sell(jsonb_build_array(pg_temp.line('d4000000-0000-0000-0000-000000000001', 1, 'PERCENT', '50')), '[{"method":"CASH","amount":"50.00"}]'::jsonb);
select t.ok(true, 'a manager may discount beyond the limit');
select pg_temp.sell(jsonb_build_array(pg_temp.line('d4000000-0000-0000-0000-000000000001', 1, 'PERCENT', '100')), '[]'::jsonb);
select t.ok(true, 'a manager may sell below cost, even free; a zero total needs no payment');
select t.owner();

select t.login('a3000000-0000-0000-0000-000000000001'); -- pharmacist: limit applies, no below-cost
select t.throws(format('select pg_temp.sell(jsonb_build_array(pg_temp.line(%L, 1, ''PERCENT'', ''45'')), ''[{"method":"CASH","amount":"55"}]''::jsonb)', 'd4000000-0000-0000-0000-000000000001'),
  'PH052', 'a pharmacist is limited to 5 percent as well');
select t.owner();

-- Below cost without a big discount: lower the batch price under cost.
update public.medicine_batches set sale_price = 5.00 where id = (select v from ids where k = 'h1');
select t.login('a4000000-0000-0000-0000-000000000001');
select t.throws(format('select pg_temp.sell(jsonb_build_array(pg_temp.line(%L, 1)), ''[{"method":"CASH","amount":"5.00"}]''::jsonb)', 'd4000000-0000-0000-0000-000000000001'),
  'PH053', 'selling below cost needs sale.discount');
select t.owner();
update public.medicine_batches set sale_price = 100.00 where id = (select v from ids where k = 'h1');

-- Prescription medicines
select t.login('a4000000-0000-0000-0000-000000000001');
select t.throws(format('select pg_temp.sell(jsonb_build_array(pg_temp.line(%L, 1)), ''[{"method":"CASH","amount":"10.00"}]''::jsonb)', 'd5000000-0000-0000-0000-000000000001'),
  'PH054', 'a cashier cannot sell a prescription medicine');
select t.owner();
select t.login('a3000000-0000-0000-0000-000000000001');
select pg_temp.sell(jsonb_build_array(pg_temp.line('d5000000-0000-0000-0000-000000000001', 1)), '[{"method":"CASH","amount":"10.00"}]'::jsonb);
select t.ok(true, 'a pharmacist can');
select t.owner();

-- ---- payments ---------------------------------------------------------------------------------------
select t.login('a4000000-0000-0000-0000-000000000001');
-- The brief's mixed payment: total 1,000 = cash 500 + bKash 300 + credit 200.
insert into ids values ('mix', (pg_temp.sell(
  jsonb_build_array(pg_temp.line('d4000000-0000-0000-0000-000000000001', 10)),
  '[{"method":"CASH","amount":"500.00"},{"method":"BKASH","amount":"300.00","reference":"BK1"},{"method":"CREDIT","amount":"200.00"}]'::jsonb,
  'c2000000-0000-0000-0000-000000000001') ->> 'id')::uuid);
select t.owner();
select t.ok((select grand_total = 1000.00 and paid_total = 800.00 and due_total = 200.00 from public.sales where id = (select v from ids where k = 'mix')),
  'mixed payment: 1000 = 500 cash + 300 bKash + 200 credit');
select t.ok((select string_agg(method || ':' || amount, ',' order by id) = 'CASH:500.00,BKASH:300.00' from public.payments where sale_id = (select v from ids where k = 'mix')),
  'money methods are recorded as payments; credit is not');
select t.ok((select count(*) = 1 and sum(amount) = 200.00 and max(entry_type) = 'SALE_DUE' from public.customer_ledger_entries where sale_id = (select v from ids where k = 'mix')),
  'the credit portion became one SALE_DUE ledger entry');
select t.ok((select sum(amount) = 200.00 from public.customer_ledger_entries where customer_id = 'c2000000-0000-0000-0000-000000000001'), 'the customer now owes 200.00');

select t.login('a4000000-0000-0000-0000-000000000001');
select t.ok(public.customer_balance('aaaaaaaa-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000001') = 200.00, 'customer_balance agrees');
-- exactness
select t.throws(format('select pg_temp.sell(jsonb_build_array(pg_temp.line(%L, 1)), ''[{"method":"CASH","amount":"99.99"}]''::jsonb)', 'd4000000-0000-0000-0000-000000000001'),
  'PH051', 'paying one paisa short is refused');
select t.throws(format('select pg_temp.sell(jsonb_build_array(pg_temp.line(%L, 1)), ''[{"method":"CASH","amount":"100.01"}]''::jsonb)', 'd4000000-0000-0000-0000-000000000001'),
  'PH051', 'paying one paisa over is refused');
select t.throws(format('select pg_temp.sell(jsonb_build_array(pg_temp.line(%L, 1)), ''[]''::jsonb)', 'd4000000-0000-0000-0000-000000000001'),
  'PH051', 'no payment at all is refused');
select t.throws(format('select pg_temp.sell(jsonb_build_array(pg_temp.line(%L, 1)), ''[{"method":"CASH","amount":"50.00"},{"method":"BANK","amount":"49.99"}]''::jsonb)', 'd4000000-0000-0000-0000-000000000001'),
  'PH051', 'split payments that add up to 99.99 are refused');
select t.throws(format('select pg_temp.sell(jsonb_build_array(pg_temp.line(%L, 1)), ''[{"method":"CHEQUE","amount":"100.00"}]''::jsonb)', 'd4000000-0000-0000-0000-000000000001'),
  '22023', 'an unknown payment method is refused');
select t.throws(format('select pg_temp.sell(jsonb_build_array(pg_temp.line(%L, 1)), ''[{"method":"CASH","amount":"100.001"}]''::jsonb)', 'd4000000-0000-0000-0000-000000000001'),
  '22023', 'an amount with three decimals is refused');
select t.throws(format('select pg_temp.sell(jsonb_build_array(pg_temp.line(%L, 1)), ''[{"method":"CASH","amount":"-100.00"}]''::jsonb)', 'd4000000-0000-0000-0000-000000000001'),
  '22023', 'a negative payment is refused');
select t.throws(format('select pg_temp.sell(jsonb_build_array(pg_temp.line(%L, 1)), ''[{"method":"CASH","amount":"0"}]''::jsonb)', 'd4000000-0000-0000-0000-000000000001'),
  '22023', 'a zero payment is refused');
-- every real method is accepted
select pg_temp.sell(jsonb_build_array(pg_temp.line('d4000000-0000-0000-0000-000000000001', 1)),
  '[{"method":"CASH","amount":"10.00"},{"method":"BKASH","amount":"10.00"},{"method":"nagad","amount":"20.00"},{"method":"ROCKET","amount":"20.00"},{"method":"CARD","amount":"20.00"},{"method":"BANK","amount":"20.00"}]'::jsonb);
select t.ok(true, 'cash, bKash, Nagad, Rocket, card and bank can all be combined (method is case-insensitive)');

-- credit
select t.throws(format('select pg_temp.sell(jsonb_build_array(pg_temp.line(%L, 1)), ''[{"method":"CREDIT","amount":"100.00"}]''::jsonb)', 'd4000000-0000-0000-0000-000000000001'),
  'PH055', 'credit without a customer is refused (walk-in cannot owe)');
select t.throws(format('select pg_temp.sell(jsonb_build_array(pg_temp.line(%L, 1)), ''[{"method":"CREDIT","amount":"100.00"}]''::jsonb, %L)', 'd4000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000001'),
  'P0002', 'a customer of another branch cannot be used');
-- Rahim: limit 500, owes 0.
select pg_temp.sell(jsonb_build_array(pg_temp.line('d4000000-0000-0000-0000-000000000001', 5)), '[{"method":"CREDIT","amount":"500.00"}]'::jsonb, 'c1000000-0000-0000-0000-000000000001');
select t.ok(true, 'credit up to exactly the limit is allowed');
select t.throws(format('select pg_temp.sell(jsonb_build_array(pg_temp.line(%L, 1)), ''[{"method":"CREDIT","amount":"100.00"}]''::jsonb, %L)', 'd4000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001'),
  'PH056', 'one more taka over the credit limit is refused');
select t.ok(public.customer_balance('aaaaaaaa-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001') = 500.00, 'the refused sale did not add to the balance');
select t.owner();

-- ---- atomicity ------------------------------------------------------------------------------------------
create function pg_temp.boom() returns trigger language plpgsql as $f$ begin raise exception 'simulated failure while recording payments'; end $f$;
create trigger boom before insert on public.payments for each row execute function pg_temp.boom();

create temp table before_state as select
  (select count(*) from public.sales) as sales,
  (select count(*) from public.stock_movements) as movements,
  (select coalesce(sum(quantity), 0) from public.medicine_batches) as units,
  (select last_seq from public.invoice_counters where branch_id = 'aaaaaaaa-0000-0000-0000-000000000001') as seq,
  (select count(*) from public.customer_ledger_entries) as ledger,
  (select count(*) from public.audit_log) as audit,
  (select count(*) from public.sale_items) as items,
  (select count(*) from public.sale_item_allocations) as allocs;
grant select on before_state to authenticated;

select t.login('a4000000-0000-0000-0000-000000000001');
select t.throws(format('select pg_temp.sell(jsonb_build_array(pg_temp.line(%L, 7)), ''[{"method":"CASH","amount":"700.00"}]''::jsonb)', 'd4000000-0000-0000-0000-000000000001'),
  'P0001', 'a failure while writing payments aborts the whole sale');
select t.owner();
drop trigger boom on public.payments;

select t.ok(
  (select s.sales = (select count(*) from public.sales)
      and s.movements = (select count(*) from public.stock_movements)
      and s.units = (select coalesce(sum(quantity), 0) from public.medicine_batches)
      and s.seq = (select last_seq from public.invoice_counters where branch_id = 'aaaaaaaa-0000-0000-0000-000000000001')
      and s.ledger = (select count(*) from public.customer_ledger_entries)
      and s.audit = (select count(*) from public.audit_log)
      and s.items = (select count(*) from public.sale_items)
      and s.allocs = (select count(*) from public.sale_item_allocations)
   from before_state s),
  'after the failure: no sale, no lines, no allocations, no movements, no ledger, no audit, stock and invoice number unchanged');

-- A validation failure leaves nothing behind either.
select t.login('a4000000-0000-0000-0000-000000000001');
select t.throws(format('select pg_temp.sell(jsonb_build_array(pg_temp.line(%L, 3), pg_temp.line(%L, 500)), ''[{"method":"CASH","amount":"1.00"}]''::jsonb)', 'd4000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000001'),
  'PH001', 'a cart whose second line is short of stock fails as a whole');
select t.owner();
select t.ok((select s.units = (select coalesce(sum(quantity), 0) from public.medicine_batches) and s.sales = (select count(*) from public.sales) from before_state s),
  'the first line of that cart was not sold either');

-- ---- lines in one cart share stock ----------------------------------------------------------------------
select t.login('a4000000-0000-0000-0000-000000000001');
select t.owner();
select t.login('a3000000-0000-0000-0000-000000000001');
select t.throws(format('select pg_temp.sell(jsonb_build_array(pg_temp.line(%L, 15), pg_temp.line(%L, 15)), ''[{"method":"CASH","amount":"300.00"}]''::jsonb)',
  'd5000000-0000-0000-0000-000000000001', 'd5000000-0000-0000-0000-000000000001'),
  'PH001', 'two lines of the same medicine cannot together exceed its stock (19 on hand)');
select t.owner();

-- ---- idempotency ----------------------------------------------------------------------------------------------
select t.login('a4000000-0000-0000-0000-000000000001');
create temp table idem (n integer, invoice jsonb);
grant all on idem to authenticated;
insert into idem select 1, pg_temp.sell(jsonb_build_array(pg_temp.line('d4000000-0000-0000-0000-000000000001', 2)), '[{"method":"CASH","amount":"200.00"}]'::jsonb, null, '77777777-0000-0000-0000-000000000001');
insert into idem select 2, pg_temp.sell(jsonb_build_array(pg_temp.line('d4000000-0000-0000-0000-000000000001', 2)), '[{"method":"CASH","amount":"200.00"}]'::jsonb, null, '77777777-0000-0000-0000-000000000001');
select t.owner();
select t.ok((select count(*) = 1 from public.sales where client_request_id = '77777777-0000-0000-0000-000000000001'), 'a repeated client_request_id makes one sale');
select t.ok((select invoice from idem where n = 1) = (select invoice from idem where n = 2), 'and returns the same invoice');
select t.ok((select count(*) = 1 from public.stock_movements where reference_id = (select id::text from public.sales where client_request_id = '77777777-0000-0000-0000-000000000001')),
  'and moved the stock once');

-- ---- invoice contents and numbering ------------------------------------------------------------------------------
select t.ok((select (invoice -> 'totals' ->> 'grand_total') = '200.00' and (invoice -> 'items' -> 0 ->> 'quantity') = '2'
              and (invoice ->> 'invoice_no') like 'INV-%' and invoice ? 'branch' and invoice ? 'payments'
              and not (invoice::text like '%cost%') and not (invoice::text like '%profit%')
               from idem where n = 1),
  'the invoice carries totals, lines, branch and payments, and no cost or profit');
select t.ok((select jsonb_typeof(invoice -> 'totals' -> 'grand_total') = 'string' from idem where n = 1), 'money in the invoice is text, not a float');
select t.ok((select count(*) = count(distinct invoice_no) and count(*) = max(invoice_seq) from public.sales where branch_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'invoice numbers are unique and gap-free in the branch');

-- ---- invoice and history visibility ---------------------------------------------------------------------------------
select t.login('a4000000-0000-0000-0000-000000000001'); -- cashier: own sales only
select t.ok((public.get_invoice((select v from ids where k = 'inv1')) ->> 'invoice_no') = 'INV-000001', 'the cashier can open their own invoice');
select t.owner();
select t.login('a3000000-0000-0000-0000-000000000001'); -- pharmacist did not make inv1
select t.throws(format('select public.get_invoice(%L)', (select v from ids where k = 'inv1')), '42501', 'a pharmacist cannot open the cashier''s invoice');
select t.ok(t.count('select 1 from public.sales') > 0 and (select bool_and(created_by = 'a3000000-0000-0000-0000-000000000001') from public.sales), 'direct reads show only own sales');
select t.owner();
select t.login('a2000000-0000-0000-0000-000000000001'); -- manager: sale.view_all
select t.ok((public.get_invoice((select v from ids where k = 'inv1')) ->> 'invoice_no') = 'INV-000001', 'a manager (sale.view_all) can open any invoice');
select t.owner();
select t.login('b1000000-0000-0000-0000-000000000001');
select t.throws(format('select public.get_invoice(%L)', (select v from ids where k = 'inv1')), '42501', 'admin B cannot open a Branch A invoice');
select t.ok(t.count('select 1 from public.sales') = 0, 'admin B sees no Branch A sales');
select t.ok(t.count('select 1 from public.payments') = 0 and t.count('select 1 from public.sale_items') = 0 and t.count('select 1 from public.sale_item_allocations') = 0,
  'nor their lines, allocations or payments');
select t.owner();

select t.login('a4000000-0000-0000-0000-000000000001');
select t.ok((select count(*) > 0 and bool_and(cashier_name = 'Cashier A') and bool_and(cost_total is null and profit_total is null)
               from public.list_sales('aaaaaaaa-0000-0000-0000-000000000001')), 'the cashier''s history is their own sales, without cost or profit');
select t.throws('select cost_total from public.sales', '42501', 'cost_total cannot be read directly');
select t.throws('select profit from public.sale_items', '42501', 'line profit cannot be read directly');
select t.throws('select unit_cost from public.sale_item_allocations', '42501', 'the batch cost snapshot cannot be read directly');
select t.ok((select count(*) = 1 from public.list_sales('aaaaaaaa-0000-0000-0000-000000000001', 'INV-000001')), 'search history by invoice number');
select t.ok((select count(*) = 0 from public.list_sales('aaaaaaaa-0000-0000-0000-000000000001', '', current_date + 1, null)), 'date filter: nothing after today');
select t.ok((select max(invoice_seq) > min(invoice_seq) and array_agg(invoice_seq order by invoice_seq desc) = array_agg(invoice_seq)
               from public.list_sales('aaaaaaaa-0000-0000-0000-000000000001')), 'history is newest first');
select t.ok((select max(invoice_seq) < (select min(invoice_seq) + 100 from public.list_sales('aaaaaaaa-0000-0000-0000-000000000001', '', null, null, null, 2))
              from public.list_sales('aaaaaaaa-0000-0000-0000-000000000001', '', null, null, (select min(invoice_seq) from public.list_sales('aaaaaaaa-0000-0000-0000-000000000001', '', null, null, null, 2)), 2)),
  'keyset paging continues below the cursor');
select t.owner();
select t.login('a2000000-0000-0000-0000-000000000001'); -- manager
select t.ok((select bool_and(cost_total is not null and profit_total is not null) from public.list_sales('aaaaaaaa-0000-0000-0000-000000000001', 'INV-000001')),
  'a manager sees cost and profit in history');
select t.ok((select profit_total = 19.0000 and cost_total = 56.0000 from public.list_sales('aaaaaaaa-0000-0000-0000-000000000001', 'INV-000001')), 'and they are the recorded figures');
select t.owner();

-- ---- sales are immutable ------------------------------------------------------------------------------------------------
select t.throws('update public.sales set grand_total = 1', 'PH010', 'a sale cannot be edited, even by the owner');
select t.throws('delete from public.sale_items', 'PH010', 'sale lines cannot be deleted');
select t.throws('update public.payments set amount = 1', 'PH010', 'payments cannot be edited');
select t.throws('delete from public.customer_ledger_entries', 'PH010', 'ledger entries cannot be deleted');
select t.throws('truncate public.sales', '0A000', 'sales cannot be truncated (it is referenced by sale lines)');
select t.throws('truncate public.payments', '0A000', 'payments cannot be truncated (the customer ledger references them)');
select t.throws('truncate public.customer_ledger_entries', 'PH010', 'ledger entries cannot be truncated');
select t.throws('insert into public.customer_ledger_entries (branch_id, customer_id, entry_type, amount) values (''aaaaaaaa-0000-0000-0000-000000000001'', ''c1000000-0000-0000-0000-000000000001'', ''SALE_DUE'', -5)',
  '23514', 'a SALE_DUE entry must be positive');
select t.throws('insert into public.customer_ledger_entries (branch_id, customer_id, entry_type, amount) values (''aaaaaaaa-0000-0000-0000-000000000001'', ''c1000000-0000-0000-0000-000000000001'', ''PAYMENT'', 5)',
  '23514', 'a PAYMENT entry must be negative');

-- ---- quote ----------------------------------------------------------------------------------------------------------------
select t.login('a4000000-0000-0000-0000-000000000001');
create temp table q as select public.quote_sale('aaaaaaaa-0000-0000-0000-000000000001',
  jsonb_build_array(pg_temp.line('d3000000-0000-0000-0000-000000000001', 5))) as quote;
grant select on q to authenticated;
select t.ok((select quote -> 'totals' ->> 'grand_total' from q) is not null, 'the quote returns totals');
select t.ok((select not (quote::text like '%unit_cost%') and not (quote::text like '%cost_total%') and not (quote::text like '%profit%') from q),
  'a cashier''s quote contains no cost or profit');
select t.owner();
select t.login('a2000000-0000-0000-0000-000000000001');
select t.ok((select (public.quote_sale('aaaaaaaa-0000-0000-0000-000000000001', jsonb_build_array(pg_temp.line('d4000000-0000-0000-0000-000000000001', 2))) -> 'totals' ->> 'profit_total') = '80.0000'), 'a manager''s quote includes profit');
select t.owner();

-- quote and sale agree, and the quote writes nothing.
select t.login('a4000000-0000-0000-0000-000000000001');
create temp table agree as select
  public.quote_sale('aaaaaaaa-0000-0000-0000-000000000001', jsonb_build_array(pg_temp.line('d2000000-0000-0000-0000-000000000001', 7))) -> 'totals' as quoted,
  (select count(*) from public.stock_movements) as movements_before,
  (select quantity from public.medicine_batches where id = (select v from ids where k = 'tx')) as qty_before;
grant select on agree to authenticated;
select t.ok((select movements_before = (select count(*) from public.stock_movements) and qty_before = pg_temp.qty('tx') from agree), 'quoting wrote nothing and changed no stock');
insert into ids values ('agree', (pg_temp.sell(jsonb_build_array(pg_temp.line('d2000000-0000-0000-0000-000000000001', 7)),
  jsonb_build_array(jsonb_build_object('method', 'CASH', 'amount', (select quoted ->> 'grand_total' from agree)))) ->> 'id')::uuid);
select t.owner();
select t.ok((select s.grand_total::text = a.quoted ->> 'grand_total' and s.tax_total::text = a.quoted ->> 'tax_total' and s.subtotal::text = a.quoted ->> 'subtotal'
               from public.sales s, agree a where s.id = (select v from ids where k = 'agree')),
  'paying exactly the quoted total completes the sale and the totals match the quote');

-- ---- drafts ---------------------------------------------------------------------------------------------------------------------
select t.login('a4000000-0000-0000-0000-000000000001');
insert into ids values ('draft', public.save_sale_draft(jsonb_build_object('branch_id', 'aaaaaaaa-0000-0000-0000-000000000001', 'name', 'Mrs Akter',
  'customer_id', 'c1000000-0000-0000-0000-000000000001', 'items', jsonb_build_array(pg_temp.line('d1000000-0000-0000-0000-000000000001', 2)))));
select t.ok(t.count('select 1 from public.sale_drafts') = 1, 'a draft is saved');
select public.save_sale_draft(jsonb_build_object('id', (select v from ids where k = 'draft'), 'branch_id', 'aaaaaaaa-0000-0000-0000-000000000001',
  'items', jsonb_build_array(pg_temp.line('d1000000-0000-0000-0000-000000000001', 3))));
select t.ok((select jsonb_array_length(cart) = 1 and (cart -> 0 ->> 'quantity') = '3' and customer_id is null from public.sale_drafts where id = (select v from ids where k = 'draft')), 'a draft can be updated');
select t.throws('select public.save_sale_draft(jsonb_build_object(''branch_id'', ''aaaaaaaa-0000-0000-0000-000000000001'', ''items'', jsonb_build_array(jsonb_build_object(''medicine_id'', ''x'', ''price'', 1))))', '22023', 'a draft line with a price field is refused (prices are never taken from the client)');
select t.throws('select public.save_sale_draft(jsonb_build_object(''branch_id'', ''aaaaaaaa-0000-0000-0000-000000000001'', ''items'', ''[]''::jsonb))', '22023', 'an empty draft is refused');
select t.throws('insert into public.sale_drafts (branch_id, cart) values (''aaaaaaaa-0000-0000-0000-000000000001'', ''[]'')', '42501', 'no direct writes to drafts');
select t.owner();
select t.ok(pg_temp.qty('na') = 0 and (select quantity from public.medicine_batches where batch_number = 'A' and medicine_id = 'd1000000-0000-0000-0000-000000000001') = 0, 'a draft does not touch stock');
select t.login('a3000000-0000-0000-0000-000000000001');
select t.ok(t.count('select 1 from public.sale_drafts') = 0, 'another user cannot see the draft');
select t.throws(format('select public.save_sale_draft(jsonb_build_object(''id'', %L, ''branch_id'', ''aaaaaaaa-0000-0000-0000-000000000001'', ''items'', jsonb_build_array(pg_temp.line(%L, 1))))', (select v from ids where k = 'draft'), 'd1000000-0000-0000-0000-000000000001'), 'P0002', 'nor change it');
select t.throws(format('select public.delete_sale_draft(%L)', (select v from ids where k = 'draft')), 'P0002', 'nor delete it');
select t.owner();
select t.login('a4000000-0000-0000-0000-000000000001');
select public.delete_sale_draft((select v from ids where k = 'draft'));
select t.ok(t.count('select 1 from public.sale_drafts') = 0, 'the owner can delete their draft');
select t.owner();

-- ---- customers --------------------------------------------------------------------------------------------------------------------
select t.login('a4000000-0000-0000-0000-000000000001'); -- cashier: customer.edit
insert into ids values ('newcust', public.save_customer(jsonb_build_object('branch_id', 'aaaaaaaa-0000-0000-0000-000000000001', 'name', '  Karim  ', 'phone', '01733333333')));
select t.ok((select name = 'Karim' and credit_limit is null from public.customers where id = (select v from ids where k = 'newcust')), 'a cashier can add a customer (name trimmed, no limit)');
select t.throws('select public.save_customer(jsonb_build_object(''branch_id'', ''aaaaaaaa-0000-0000-0000-000000000001'', ''name'', ''Dup'', ''phone'', ''01733333333''))', '23505', 'a phone number can belong to one customer per branch');
select t.throws('select public.save_customer(jsonb_build_object(''branch_id'', ''aaaaaaaa-0000-0000-0000-000000000001'', ''name'', ''X'', ''credit_limit'', ''10.005''))', '22023', 'a credit limit has at most 2 decimals');
select t.throws('select public.save_customer(jsonb_build_object(''branch_id'', ''aaaaaaaa-0000-0000-0000-000000000001'', ''name'', ''X'', ''balance'', 99))', '22023', 'a customer balance cannot be set (unknown field)');
select t.ok((select count(*) = 1 and max(phone) = '01711111111' from public.search_customers('aaaaaaaa-0000-0000-0000-000000000001', '0171')), 'search customers by phone');
select t.ok((select count(*) = 1 and max(name) = 'Rahim' and max(balance) = 500.00 from public.search_customers('aaaaaaaa-0000-0000-0000-000000000001', 'rah')), 'search customers by name, with their balance');
select t.owner();
select t.login('b1000000-0000-0000-0000-000000000001');
select t.throws('select public.save_customer(jsonb_build_object(''branch_id'', ''aaaaaaaa-0000-0000-0000-000000000001'', ''name'', ''X''))', '42501', 'admin B cannot add customers to Branch A');
select t.ok(t.count('select 1 from public.customers') = 1, 'admin B sees only Branch B customers');
select t.owner();

-- ---- the invariant still holds after all of that ------------------------------------------------------------------------------------
set constraints all immediate;
select t.ok(true, 'every batch still equals the sum of its movements at commit');
select t.login('a1000000-0000-0000-0000-000000000001');
select t.ok((select count(*) = 0 from public.stock_reconciliation('aaaaaaaa-0000-0000-0000-000000000001')), 'reconciliation shows no drift after all the sales');
select t.owner();

-- ---- audit ----------------------------------------------------------------------------------------------------------------------------------
select t.ok((select count(*) = 1 and max(new_values ->> 'grand_total') = '75.00' from public.audit_log
              where action = 'sale.complete' and entity_id = (select v::text from ids where k = 'inv1')
                and actor_id = 'a4000000-0000-0000-0000-000000000001'),
  'each sale is audited with its actor and totals');

rollback;
