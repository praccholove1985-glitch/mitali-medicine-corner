-- Suppliers, purchases and the supplier ledger: pricing and rounding, batches (new and top-up),
-- free units, stock movements, duplicate invoices, payments, atomicity, idempotency, permissions.
-- Money is compared as exact decimals.
begin;

create temp table ids (k text primary key, v jsonb) on commit drop;
grant all on ids to authenticated;

insert into public.medicines (id, name, default_sale_price, mrp, tax_rate, is_active) values
  ('f1000000-0000-0000-0000-0000000000a1', 'Napa',     1.50, 2.00, 0, true),
  ('f2000000-0000-0000-0000-0000000000a1', 'NoPrice',  null, null, 0, true),
  ('f3000000-0000-0000-0000-0000000000a1', 'Retired',  1.50, 2.00, 0, false);

insert into public.suppliers (id, branch_id, name, phone, is_active) values
  ('a1000000-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-000000000001', 'Square',  '01911111111', true),
  ('a2000000-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-000000000001', 'Beximco', '01922222222', true),
  ('a3000000-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-000000000001', 'Closed',  null, false),
  ('b1000000-0000-0000-0000-0000000000f1', 'bbbbbbbb-0000-0000-0000-000000000001', 'Branch B supplier', null, true);

insert into public.customers (id, branch_id, name) values ('c9000000-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-000000000001', 'A customer');

create function pg_temp.line(p_med text, p_batch text, p_days integer, p_qty integer, p_free integer, p_price text,
                             p_dtype text default null, p_dvalue text default null, p_tax text default null,
                             p_sale text default null, p_mrp text default null) returns jsonb
language sql as $f$
  select jsonb_strip_nulls(jsonb_build_object(
    'medicine_id', p_med, 'batch_number', p_batch, 'expiry_date', (current_date + p_days)::text,
    'quantity', p_qty, 'free_quantity', p_free, 'unit_price', p_price,
    'discount_type', p_dtype, 'discount_value', p_dvalue, 'tax_rate', p_tax, 'sale_price', p_sale, 'mrp', p_mrp))
$f$;
grant execute on function pg_temp.line(text, text, integer, integer, integer, text, text, text, text, text, text) to authenticated;

create function pg_temp.buy(p_supplier text, p_items jsonb, p_payments jsonb default '[]'::jsonb, p_invoice text default null,
                            p_date date default current_date, p_request uuid default gen_random_uuid(),
                            p_branch text default 'aaaaaaaa-0000-0000-0000-000000000001') returns jsonb
language sql as $f$
  select public.create_purchase(jsonb_build_object(
    'branch_id', p_branch::uuid, 'client_request_id', p_request, 'supplier_id', p_supplier::uuid,
    'supplier_invoice_no', coalesce(p_invoice, 'INV-' || substr(p_request::text, 1, 8)),
    'invoice_date', p_date::text, 'items', p_items, 'payments', p_payments))
$f$;
grant execute on function pg_temp.buy(text, jsonb, jsonb, text, date, uuid, text) to authenticated;

create function pg_temp.q(p_items jsonb, p_supplier text default 'a1000000-0000-0000-0000-0000000000f1') returns jsonb
language sql as $f$
  select public.quote_purchase('aaaaaaaa-0000-0000-0000-000000000001', p_supplier::uuid, p_items)
$f$;
grant execute on function pg_temp.q(jsonb, text) to authenticated;

-- ---- permissions ---------------------------------------------------------------------------
select t.anon();
select t.throws('select public.create_purchase(''{}''::jsonb)', '42501', 'anon cannot record a purchase');
select t.throws('select * from public.list_suppliers(''aaaaaaaa-0000-0000-0000-000000000001'')', '42501', 'anon cannot list suppliers');
select t.owner();

select t.login('a3000000-0000-0000-0000-000000000001'); -- pharmacist: stock and catalogue, no purchasing
select t.throws(format('select pg_temp.buy(%L, jsonb_build_array(pg_temp.line(%L, ''B'', 100, 1, 0, ''1.00'', null, null, null, ''1.5'', ''2'')))', 'a1000000-0000-0000-0000-0000000000f1', 'f1000000-0000-0000-0000-0000000000a1'), '42501', 'a pharmacist cannot record a purchase');
select t.throws('select * from public.list_suppliers(''aaaaaaaa-0000-0000-0000-000000000001'')', '42501', 'a pharmacist cannot list suppliers');
select t.throws('select public.save_supplier(jsonb_build_object(''branch_id'', ''aaaaaaaa-0000-0000-0000-000000000001'', ''name'', ''X''))', '42501', 'a pharmacist cannot add a supplier');
select t.throws('select * from public.list_purchases(''aaaaaaaa-0000-0000-0000-000000000001'')', '42501', 'a pharmacist cannot read purchases');
select t.owner();

select t.login('a4000000-0000-0000-0000-000000000001'); -- cashier
select t.throws(format('select pg_temp.q(jsonb_build_array(pg_temp.line(%L, ''B'', 100, 1, 0, ''1.00'')))', 'f1000000-0000-0000-0000-0000000000a1'), '42501', 'a cashier cannot preview a purchase (it shows cost)');
select t.ok(t.count('select 1 from public.purchases') = 0 and t.count('select 1 from public.suppliers') = 0, 'a cashier reads no purchases or suppliers directly');
select t.throws('select 1 from public.purchase_items', '42501', 'nobody reads purchase lines straight from the table');
select t.owner();

select t.login('b1000000-0000-0000-0000-000000000001'); -- admin of Branch B
select t.throws(format('select pg_temp.buy(%L, jsonb_build_array(pg_temp.line(%L, ''B'', 100, 1, 0, ''1.00'', null, null, null, ''1.5'', ''2'')))', 'a1000000-0000-0000-0000-0000000000f1', 'f1000000-0000-0000-0000-0000000000a1'), '42501', 'admin B cannot record a purchase in Branch A');
select t.throws('select * from public.list_suppliers(''aaaaaaaa-0000-0000-0000-000000000001'')', '42501', 'admin B cannot list Branch A suppliers');
select t.ok((select count(*) = 1 and max(name) = 'Branch B supplier' from public.list_suppliers('bbbbbbbb-0000-0000-0000-000000000001')), 'admin B sees only their own suppliers');
select t.owner();

-- ---- suppliers -------------------------------------------------------------------------------------
select t.login('a2000000-0000-0000-0000-000000000001'); -- manager
insert into ids values ('newsup', to_jsonb(public.save_supplier(jsonb_build_object('branch_id', 'aaaaaaaa-0000-0000-0000-000000000001', 'name', '  Incepta  ', 'phone', '01933333333', 'contact_person', 'Mr Rahman'))));
select t.ok((select name = 'Incepta' and is_active from public.suppliers where id = (select (v #>> '{}')::uuid from ids where k = 'newsup')), 'a manager can add a supplier (name trimmed)');
select t.throws('select public.save_supplier(jsonb_build_object(''branch_id'', ''aaaaaaaa-0000-0000-0000-000000000001'', ''name'', ''SQUARE''))', '23505', 'supplier names are unique per branch, ignoring case');
select t.throws('select public.save_supplier(jsonb_build_object(''branch_id'', ''aaaaaaaa-0000-0000-0000-000000000001'', ''name'', ''X'', ''balance'', 5))', '22023', 'a supplier balance cannot be set');
select t.ok((select count(*) = 1 and max(name) = 'Square' from public.search_suppliers('aaaaaaaa-0000-0000-0000-000000000001', 'squ')), 'search suppliers by name');
select t.ok((select count(*) = 0 from public.search_suppliers('aaaaaaaa-0000-0000-0000-000000000001', 'clos')), 'inactive suppliers are not offered for new purchases');
select t.ok((select count(*) = 0 from public.search_suppliers('aaaaaaaa-0000-0000-0000-000000000001', '%')), 'a percent sign is searched literally');
select t.owner();

-- ---- pricing and rounding (quote) ------------------------------------------------------------------
select t.login('a1000000-0000-0000-0000-000000000001'); -- admin
select t.ok((select l ->> 'gross' = '100.00' and l ->> 'discount' = '10.00' and l ->> 'tax_amount' = '4.50'
                and l ->> 'line_total' = '94.50' and l ->> 'unit_cost' = '7.8750'
               from (select pg_temp.q(jsonb_build_array(pg_temp.line('f1000000-0000-0000-0000-0000000000a1', 'Q1', 100, 10, 2, '10.00', 'PERCENT', '10', '5'))) -> 'lines' -> 0 as l) x),
  '10 + 2 free at 10.00, 10% off, 5% VAT: gross 100, discount 10, VAT 4.50, total 94.50, cost 7.875 per unit over 12 units');
select t.ok((select l ->> 'gross' = '1.00' and l ->> 'unit_cost' = '0.3333'
               from (select pg_temp.q(jsonb_build_array(pg_temp.line('f1000000-0000-0000-0000-0000000000a1', 'Q2', 100, 3, 0, '0.3333'))) -> 'lines' -> 0 as l) x),
  'gross is rounded once: 3 x 0.3333 = 0.9999 -> 1.00; cost 0.3333');
select t.ok((select l ->> 'gross' = '1.01'
               from (select pg_temp.q(jsonb_build_array(pg_temp.line('f1000000-0000-0000-0000-0000000000a1', 'Q3', 100, 1, 0, '1.0050'))) -> 'lines' -> 0 as l) x),
  'half rounds up: 1.005 -> 1.01');
select t.ok((select l ->> 'line_total' = '0.00' and l ->> 'unit_cost' = '0.0000'
               from (select pg_temp.q(jsonb_build_array(pg_temp.line('f1000000-0000-0000-0000-0000000000a1', 'Q4', 100, 0, 5, '10.00'))) -> 'lines' -> 0 as l) x),
  'a line of only free units costs nothing');
select t.ok((select l ->> 'discount' = '25.00' and l ->> 'line_total' = '75.00'
               from (select pg_temp.q(jsonb_build_array(pg_temp.line('f1000000-0000-0000-0000-0000000000a1', 'Q5', 100, 10, 0, '10.00', 'AMOUNT', '25'))) -> 'lines' -> 0 as l) x),
  'an amount discount comes off the gross');
select t.ok((select r -> 'totals' ->> 'subtotal' = '200.00' and r -> 'totals' ->> 'discount_total' = '20.00' and r -> 'totals' ->> 'tax_total' = '9.00' and r -> 'totals' ->> 'grand_total' = '189.00'
               from (select pg_temp.q(jsonb_build_array(
                       pg_temp.line('f1000000-0000-0000-0000-0000000000a1', 'T1', 100, 10, 0, '10.00', 'PERCENT', '10', '5'),
                       pg_temp.line('f1000000-0000-0000-0000-0000000000a1', 'T2', 100, 10, 0, '10.00', 'PERCENT', '10', '5'))) as r) x),
  'totals add the rounded lines: 200 - 20 + 9 = 189');
select t.throws(format('select pg_temp.q(jsonb_build_array(pg_temp.line(%L, ''B'', 100, 10, 0, ''10'', ''AMOUNT'', ''100.01'')))', 'f1000000-0000-0000-0000-0000000000a1'), 'PH050', 'a discount above the line gross is refused');
select t.throws(format('select pg_temp.q(jsonb_build_array(pg_temp.line(%L, ''B'', 100, 10, 0, ''10'', ''PERCENT'', ''100.5'')))', 'f1000000-0000-0000-0000-0000000000a1'), 'PH050', 'a discount above 100 percent is refused');
select t.throws(format('select pg_temp.q(jsonb_build_array(pg_temp.line(%L, ''B'', 100, 10, 0, ''10'', ''BOGUS'', ''1'')))', 'f1000000-0000-0000-0000-0000000000a1'), '22023', 'an unknown discount type is refused');
select t.throws(format('select pg_temp.q(jsonb_build_array(pg_temp.line(%L, ''B'', 100, 0, 0, ''10'')))', 'f1000000-0000-0000-0000-0000000000a1'), '22023', 'a line with no units at all is refused');
select t.throws(format('select pg_temp.q(jsonb_build_array(pg_temp.line(%L, ''B'', 100, -1, 5, ''10'')))', 'f1000000-0000-0000-0000-0000000000a1'), '22023', 'a negative quantity is refused');
select t.throws(format('select pg_temp.q(jsonb_build_array(pg_temp.line(%L, ''B'', 100, 1, 0, ''1.00001'')))', 'f1000000-0000-0000-0000-0000000000a1'), '22023', 'a unit price has at most 4 decimals');
select t.throws(format('select pg_temp.q(jsonb_build_array(pg_temp.line(%L, ''B'', 100, 1, 0, ''-1'')))', 'f1000000-0000-0000-0000-0000000000a1'), '22023', 'a negative price is refused');
select t.throws(format('select pg_temp.q(jsonb_build_array(pg_temp.line(%L, ''B'', 100, 1, 0, ''1'', null, null, ''100.5'')))', 'f1000000-0000-0000-0000-0000000000a1'), '22023', 'a tax rate above 100 is refused');
select t.throws('select pg_temp.q(''[]''::jsonb)', 'PH062', 'a purchase with no lines is refused');
select t.throws(format('select pg_temp.q(jsonb_build_array(jsonb_build_object(''medicine_id'', %L, ''quantity'', 1, ''unit_price'', ''1'', ''line_total'', ''0.01'')))', 'f1000000-0000-0000-0000-0000000000a1'), '22023', 'a client-sent line total is an unknown field and is refused');
select t.owner();

-- ---- recording a purchase: new batch, free units, part payment -----------------------------------------------
select t.login('a1000000-0000-0000-0000-000000000001');
insert into ids values ('p1', pg_temp.buy('a1000000-0000-0000-0000-0000000000f1',
  jsonb_build_array(pg_temp.line('f1000000-0000-0000-0000-0000000000a1', 'B1', 200, 100, 10, '1.00')),
  '[{"method":"CASH","amount":"40.00"}]'::jsonb, 'SQ-1001'));
select t.ok((select v ->> 'purchase_no' = 'PUR-000001' and v ->> 'grand_total' = '100.00' and v ->> 'paid_total' = '40.00' and v ->> 'due_total' = '60.00' and v ->> 'replayed' = 'false'
               from ids where k = 'p1'), 'the first purchase: PUR-000001, total 100.00, paid 40.00, 60.00 still owed');
select t.owner();
select t.ok((select quantity = 110 and purchase_price = 0.9091 and sale_price = 1.50 and mrp = 2.00 and supplier_id = 'a1000000-0000-0000-0000-0000000000f1' and expiry_date = current_date + 200
               from public.medicine_batches where batch_number = 'B1'),
  'the batch holds 100 + 10 free units at 100 / 110 = 0.9091 each, priced from the medicine defaults, tied to the supplier');
select t.ok((select count(*) = 1 and max(quantity_delta) = 110 and max(reference_type) = 'purchase' and max(reference_id) = (select v ->> 'purchase_id' from ids where k = 'p1')
               from public.stock_movements where movement_type = 'PURCHASE' and batch_id = (select id from public.medicine_batches where batch_number = 'B1')),
  'one PURCHASE movement of +110 points back at the purchase');
select t.owner();
select t.ok((select line_total = 100.00 and unit_cost = 0.9091 and new_batch from public.purchase_items where batch_number = 'B1'), 'the line keeps its total, effective unit cost and new-batch flag');
select t.ok((select sum(amount) = 60.00 and count(*) = 2 from public.supplier_ledger_entries where supplier_id = 'a1000000-0000-0000-0000-0000000000f1'),
  'the ledger holds the invoice (+100) and the payment (-40): 60.00 owed');
select t.ok((select count(*) = 1 and max(method) = 'CASH' and max(amount) = 40.00 and max(direction) = 'OUT' and bool_and(customer_id is null and sale_id is null)
               from public.payments where supplier_id = 'a1000000-0000-0000-0000-0000000000f1'), 'the payment is recorded as money out to the supplier');
set constraints all immediate;
select t.ok(true, 'every batch equals the sum of its movements at commit');
set constraints all deferred;

-- top-up of the same batch: cost is averaged over the units on hand, prices are untouched
select t.login('a1000000-0000-0000-0000-000000000001');
insert into ids values ('p2', pg_temp.buy('a1000000-0000-0000-0000-0000000000f1',
  jsonb_build_array(pg_temp.line('f1000000-0000-0000-0000-0000000000a1', 'B1', 200, 50, 0, '1.20', null, null, null, '9', '9')),
  '[]'::jsonb, 'SQ-1002'));
select t.ok((select v ->> 'purchase_no' = 'PUR-000002' and v ->> 'due_total' = '60.00' from ids where k = 'p2'), 'the second purchase takes the next number; nothing paid, 60.00 owed');
select t.owner();
select t.ok((select count(*) = 1 and max(quantity) = 160 and max(purchase_price) = 1.0000 and max(sale_price) = 1.50 and max(mrp) = 2.00 from public.medicine_batches where batch_number = 'B1'),
  'the same batch was topped up to 160 units; cost averaged to 1.0000; sale price and MRP untouched');
select t.ok((select not new_batch from public.purchase_items i join public.purchases pu on pu.id = i.purchase_id where pu.purchase_no = 'PUR-000002'), 'the line is flagged as a top-up');
select t.ok((select sum(amount) = 120.00 from public.supplier_ledger_entries where supplier_id = 'a1000000-0000-0000-0000-0000000000f1'), 'the supplier is now owed 120.00');
set constraints all immediate;
select t.ok(true, 'the invariant holds after a top-up');
set constraints all deferred;

-- another supplier with the same batch number is a different batch
select t.login('a1000000-0000-0000-0000-000000000001');
insert into ids values ('p3', pg_temp.buy('a2000000-0000-0000-0000-0000000000f1',
  jsonb_build_array(pg_temp.line('f1000000-0000-0000-0000-0000000000a1', 'B1', 200, 20, 0, '1.10')), '[{"method":"BKASH","amount":"22.00","reference":"TX9"}]'::jsonb, 'BX-77'));
select t.owner();
select t.ok((select count(*) = 2 from public.medicine_batches where batch_number = 'B1'), 'the same batch number from another supplier is its own batch');
select t.ok((select v ->> 'due_total' = '0.00' from ids where k = 'p3'), 'paying the whole total leaves nothing owed');

-- quote now sees the top-up
select t.login('a1000000-0000-0000-0000-000000000001');
select t.ok((select (r -> 'lines' -> 0 ->> 'tops_up_batch')::boolean and (r -> 'lines' -> 0 ->> 'days_to_expiry')::int = 200
               from (select pg_temp.q(jsonb_build_array(pg_temp.line('f1000000-0000-0000-0000-0000000000a1', 'B1', 200, 1, 0, '1.00'))) as r) x),
  'the preview says an existing batch will be topped up, and shows days to expiry');
select t.ok((select not (r -> 'lines' -> 0 ->> 'tops_up_batch')::boolean
               from (select pg_temp.q(jsonb_build_array(pg_temp.line('f1000000-0000-0000-0000-0000000000a1', 'B1', 201, 1, 0, '1.00'))) as r) x),
  'a different expiry is a different batch');

-- ---- batch prices and expiry ---------------------------------------------------------------------------------------
select t.throws(format('select pg_temp.buy(%L, jsonb_build_array(pg_temp.line(%L, ''N1'', 100, 5, 0, ''3.00'')))', 'a1000000-0000-0000-0000-0000000000f1', 'f2000000-0000-0000-0000-0000000000a1'),
  'PH063', 'a new batch of a medicine with no default price needs a sale price');
select t.throws(format('select pg_temp.buy(%L, jsonb_build_array(pg_temp.line(%L, ''N1'', 100, 5, 0, ''3.00'', null, null, null, ''5.00'', ''4.00'')))', 'a1000000-0000-0000-0000-0000000000f1', 'f2000000-0000-0000-0000-0000000000a1'),
  'PH031', 'a sale price above the MRP is refused');
insert into ids values ('p4', pg_temp.buy('a1000000-0000-0000-0000-0000000000f1',
  jsonb_build_array(pg_temp.line('f2000000-0000-0000-0000-0000000000a1', 'N1', 100, 5, 0, '3.00', null, null, null, '4.00', '5.00')), '[]'::jsonb, 'SQ-1003'));
select t.ok((select v ->> 'grand_total' = '15.00' from ids where k = 'p4'), 'with a sale price given, the new batch is accepted');
select t.throws(format('select pg_temp.buy(%L, jsonb_build_array(pg_temp.line(%L, ''E1'', 0, 5, 0, ''1.00'')))', 'a1000000-0000-0000-0000-0000000000f1', 'f1000000-0000-0000-0000-0000000000a1'), 'PH030', 'stock expiring today is refused');
select t.throws(format('select pg_temp.buy(%L, jsonb_build_array(pg_temp.line(%L, ''E2'', -30, 5, 0, ''1.00'')))', 'a1000000-0000-0000-0000-0000000000f1', 'f1000000-0000-0000-0000-0000000000a1'), 'PH030', 'already expired stock is refused');
select t.throws(format('select pg_temp.buy(%L, jsonb_build_array(pg_temp.line(%L, '''', 100, 5, 0, ''1.00'')))', 'a1000000-0000-0000-0000-0000000000f1', 'f1000000-0000-0000-0000-0000000000a1'), '22023', 'a batch number is required');
select t.throws(format('select pg_temp.buy(%L, jsonb_build_array(pg_temp.line(%L, ''R1'', 100, 5, 0, ''1.00'')))', 'a1000000-0000-0000-0000-0000000000f1', 'f3000000-0000-0000-0000-0000000000a1'), 'P0002', 'a retired medicine cannot be purchased');

-- ---- supplier and invoice rules ----------------------------------------------------------------------------------
select t.throws(format('select pg_temp.buy(%L, jsonb_build_array(pg_temp.line(%L, ''Z1'', 100, 5, 0, ''1.00'', null, null, null, ''1.5'', ''2'')))', 'a3000000-0000-0000-0000-0000000000f1', 'f1000000-0000-0000-0000-0000000000a1'), 'P0002', 'an inactive supplier cannot be bought from');
select t.throws(format('select pg_temp.buy(%L, jsonb_build_array(pg_temp.line(%L, ''Z1'', 100, 5, 0, ''1.00'', null, null, null, ''1.5'', ''2'')))', 'b1000000-0000-0000-0000-0000000000f1', 'f1000000-0000-0000-0000-0000000000a1'), 'P0002', 'a Branch B supplier is not found from Branch A');
select t.throws(format('select pg_temp.buy(%L, jsonb_build_array(pg_temp.line(%L, ''Z2'', 100, 5, 0, ''1.00'')), ''[]''::jsonb, ''sq-1001'')', 'a1000000-0000-0000-0000-0000000000f1', 'f1000000-0000-0000-0000-0000000000a1'), 'PH059', 'the same supplier invoice number (any case) cannot be entered twice');
insert into ids values ('p5', pg_temp.buy('a2000000-0000-0000-0000-0000000000f1',
  jsonb_build_array(pg_temp.line('f1000000-0000-0000-0000-0000000000a1', 'Z3', 100, 5, 0, '1.00')), '[]'::jsonb, 'SQ-1001'));
select t.ok(true, 'the same invoice number from a different supplier is fine');
select t.throws(format('select pg_temp.buy(%L, jsonb_build_array(pg_temp.line(%L, ''Z4'', 100, 5, 0, ''1.00'')), ''[]''::jsonb, ''FUT-1'', current_date + 3)', 'a1000000-0000-0000-0000-0000000000f1', 'f1000000-0000-0000-0000-0000000000a1'), '22023', 'an invoice dated in the future is refused');

-- ---- payments at purchase time ------------------------------------------------------------------------------------------
select t.throws(format('select pg_temp.buy(%L, jsonb_build_array(pg_temp.line(%L, ''Y1'', 100, 10, 0, ''1.00'')), ''[{"method":"CASH","amount":"10.01"}]''::jsonb)', 'a1000000-0000-0000-0000-0000000000f1', 'f1000000-0000-0000-0000-0000000000a1'), 'PH061', 'paying 1 paisa more than the total is refused');
select t.throws(format('select pg_temp.buy(%L, jsonb_build_array(pg_temp.line(%L, ''Y1'', 100, 10, 0, ''1.00'')), ''[{"method":"CASH","amount":"6"},{"method":"BKASH","amount":"4.01"}]''::jsonb)', 'a1000000-0000-0000-0000-0000000000f1', 'f1000000-0000-0000-0000-0000000000a1'), 'PH061', 'mixed payments that add to more than the total are refused');
select t.throws(format('select pg_temp.buy(%L, jsonb_build_array(pg_temp.line(%L, ''Y1'', 100, 10, 0, ''1.00'')), ''[{"method":"CREDIT","amount":"5"}]''::jsonb)', 'a1000000-0000-0000-0000-0000000000f1', 'f1000000-0000-0000-0000-0000000000a1'), '22023', 'credit is not a payment: what is unpaid is simply owed');
select t.throws(format('select pg_temp.buy(%L, jsonb_build_array(pg_temp.line(%L, ''Y1'', 100, 10, 0, ''1.00'')), ''[{"method":"CASH","amount":"0"}]''::jsonb)', 'a1000000-0000-0000-0000-0000000000f1', 'f1000000-0000-0000-0000-0000000000a1'), '22023', 'a zero payment is refused');
select t.throws(format('select pg_temp.buy(%L, jsonb_build_array(pg_temp.line(%L, ''Y1'', 100, 10, 0, ''1.00'')), ''[{"method":"CASH","amount":"1","note":"x"}]''::jsonb)', 'a1000000-0000-0000-0000-0000000000f1', 'f1000000-0000-0000-0000-0000000000a1'), '22023', 'unknown payment fields are refused');
select t.throws(format('select pg_temp.buy(%L, jsonb_build_array(pg_temp.line(%L, ''Y2'', 100, 0, 5, ''10.00'')), ''[{"method":"CASH","amount":"1"}]''::jsonb)', 'a1000000-0000-0000-0000-0000000000f1', 'f1000000-0000-0000-0000-0000000000a1'), 'PH061', 'nothing can be paid on an all-free purchase');
insert into ids values ('p6', pg_temp.buy('a1000000-0000-0000-0000-0000000000f1',
  jsonb_build_array(pg_temp.line('f1000000-0000-0000-0000-0000000000a1', 'Y2', 100, 0, 5, '10.00')), '[]'::jsonb, 'SQ-FREE'));
select t.ok((select v ->> 'grand_total' = '0.00' from ids where k = 'p6'), 'an all-free purchase is allowed and costs nothing');
select t.owner();
select t.ok((select count(*) = 0 from public.supplier_ledger_entries l join public.purchases pu on pu.id = l.purchase_id where pu.purchase_no = (select v ->> 'purchase_no' from ids where k = 'p6')), 'a zero-value purchase writes no ledger entry');
select t.ok((select purchase_price = 0 and quantity = 5 from public.medicine_batches where batch_number = 'Y2'), 'free stock enters at zero cost');

-- ---- atomicity and idempotency ---------------------------------------------------------------------------------------
create temp table before_counts as select
  (select count(*) from public.purchases) purchases, (select count(*) from public.medicine_batches) batches,
  (select count(*) from public.stock_movements) movements, (select count(*) from public.supplier_ledger_entries) ledger,
  (select count(*) from public.payments) payments, (select last_seq from public.purchase_counters) seq;
select t.login('a1000000-0000-0000-0000-000000000001');
select t.throws(format('select pg_temp.buy(%L, jsonb_build_array(pg_temp.line(%L, ''AT1'', 100, 5, 0, ''1.00''), pg_temp.line(%L, ''AT2'', 100, 5, 0, ''1.00'')), ''[{"method":"CASH","amount":"5"}]''::jsonb, ''ATOM-1'')',
  'a1000000-0000-0000-0000-0000000000f1', 'f1000000-0000-0000-0000-0000000000a1', 'f3000000-0000-0000-0000-0000000000a1'), 'P0002', 'a purchase whose second line fails is refused');
select t.owner();
select t.ok((select b.purchases = (select count(*) from public.purchases) and b.batches = (select count(*) from public.medicine_batches)
                and b.movements = (select count(*) from public.stock_movements) and b.ledger = (select count(*) from public.supplier_ledger_entries)
                and b.payments = (select count(*) from public.payments) and b.seq = (select last_seq from public.purchase_counters) from before_counts b),
  'the failed purchase left no purchase, batch, movement, ledger entry, payment or used number behind');

-- the same request id twice: one purchase, stock moved once
select t.login('a1000000-0000-0000-0000-000000000001');
insert into ids values ('r1', pg_temp.buy('a1000000-0000-0000-0000-0000000000f1',
  jsonb_build_array(pg_temp.line('f1000000-0000-0000-0000-0000000000a1', 'RP1', 100, 10, 0, '2.00')),
  '[{"method":"CASH","amount":"5.00"}]'::jsonb, 'SQ-RETRY', current_date, 'cccccccc-0000-0000-0000-0000000000a1'));
insert into ids values ('r2', pg_temp.buy('a1000000-0000-0000-0000-0000000000f1',
  jsonb_build_array(pg_temp.line('f1000000-0000-0000-0000-0000000000a1', 'RP1', 100, 10, 0, '2.00')),
  '[{"method":"CASH","amount":"5.00"}]'::jsonb, 'SQ-RETRY', current_date, 'cccccccc-0000-0000-0000-0000000000a1'));
select t.owner();
select t.ok((select a.v ->> 'purchase_id' = b.v ->> 'purchase_id' and a.v ->> 'purchase_no' = b.v ->> 'purchase_no'
                and a.v ->> 'replayed' = 'false' and b.v ->> 'replayed' = 'true' from ids a, ids b where a.k = 'r1' and b.k = 'r2'),
  'a retry returns the original purchase and says it was replayed');
select t.ok((select count(*) = 1 from public.purchases where supplier_invoice_no = 'SQ-RETRY')
        and (select quantity = 10 from public.medicine_batches where batch_number = 'RP1')
        and (select count(*) = 1 from public.payments where purchase_id = (select (v ->> 'purchase_id')::uuid from ids where k = 'r1')),
  'a retry did not add a second purchase, more stock or a second payment');

-- ---- reading purchases ------------------------------------------------------------------------------------------------------
select t.login('a2000000-0000-0000-0000-000000000001'); -- manager
select t.ok((select count(*) >= 5 and (array_agg(purchase_seq order by purchase_seq desc))[1] = max(purchase_seq) from public.list_purchases('aaaaaaaa-0000-0000-0000-000000000001')), 'purchases list newest first');
select t.ok((select count(*) = 1 and max(supplier_invoice_no) = 'BX-77' from public.list_purchases('aaaaaaaa-0000-0000-0000-000000000001', null, 'bx-77')), 'search purchases by supplier invoice');
select t.ok((select count(*) = 1 from public.list_purchases('aaaaaaaa-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-0000000000f1', 'bx')), 'filter purchases by supplier');
select t.ok((select count(*) = 0 from public.list_purchases('aaaaaaaa-0000-0000-0000-000000000001', null, '%')), 'a percent sign is searched literally');
select t.ok((select (g -> 'totals' ->> 'grand_total') = '100.00' and (g -> 'totals' ->> 'due_total') = '60.00'
                and jsonb_array_length(g -> 'items') = 1 and g -> 'items' -> 0 ->> 'unit_cost' = '0.9091'
                and g -> 'items' -> 0 ->> 'free_quantity' = '10' and g -> 'supplier' ->> 'name' = 'Square'
                and jsonb_array_length(g -> 'payments') = 1
               from (select public.get_purchase((select (v ->> 'purchase_id')::uuid from ids where k = 'p1')) as g) x),
  'get_purchase returns the lines with true unit cost, free units, supplier and payments');
select t.ok(public.get_purchase('00000000-0000-0000-0000-000000000000') is null, 'an unknown purchase reads as null');
select t.owner();
select t.login('b1000000-0000-0000-0000-000000000001');
select t.throws(format('select public.get_purchase(%L)', (select v ->> 'purchase_id' from ids where k = 'p1')), '42501', 'admin B cannot read a Branch A purchase');
select t.owner();

-- ---- paying a supplier -----------------------------------------------------------------------------------------------------------
create function pg_temp.pay(p_supplier text, p_amount text, p_method text default 'CASH', p_request uuid default gen_random_uuid(), p_branch text default 'aaaaaaaa-0000-0000-0000-000000000001') returns jsonb
language sql as $f$
  select public.pay_supplier(jsonb_build_object('branch_id', p_branch::uuid, 'supplier_id', p_supplier::uuid,
    'client_request_id', p_request, 'method', p_method, 'amount', p_amount))
$f$;
grant execute on function pg_temp.pay(text, text, text, uuid, text) to authenticated;

select t.login('a1000000-0000-0000-0000-000000000001');
-- Square: invoices 100 + 60 + 15 + 0 + 20 (retry purchase) = 195, paid 40 + 5 = 45  =>  owes 150.00
select t.ok((select balance = 150.00 from public.list_suppliers('aaaaaaaa-0000-0000-0000-000000000001', 'square')), 'Square is owed 150.00 across its purchases');
select t.throws(format('select pg_temp.pay(%L, ''150.01'')', 'a1000000-0000-0000-0000-0000000000f1'), 'PH060', 'paying a paisa more than is owed is refused');
select t.throws(format('select pg_temp.pay(%L, ''5'')', (select v #>> '{}' from ids where k = 'newsup')), 'PH060', 'a supplier we owe nothing cannot be paid');
select t.throws(format('select pg_temp.pay(%L, ''0'')', 'a1000000-0000-0000-0000-0000000000f1'), '22023', 'a zero payment is refused');
select t.throws(format('select pg_temp.pay(%L, ''5'', ''CREDIT'')', 'a1000000-0000-0000-0000-0000000000f1'), '22023', 'credit is not a way to pay');
select t.throws(format('select pg_temp.pay(%L, ''1.005'')', 'a1000000-0000-0000-0000-0000000000f1'), '22023', 'a third decimal is refused');
insert into ids values ('sp1', pg_temp.pay('a1000000-0000-0000-0000-0000000000f1', '50.00', 'BANK', 'dddddddd-0000-0000-0000-0000000000a1'));
insert into ids values ('sp1b', pg_temp.pay('a1000000-0000-0000-0000-0000000000f1', '50.00', 'BANK', 'dddddddd-0000-0000-0000-0000000000a1'));
select t.ok((select a.v ->> 'balance_after' = '100.00' and a.v ->> 'replayed' = 'false' and b.v ->> 'replayed' = 'true' and a.v ->> 'payment_id' = b.v ->> 'payment_id'
               from ids a, ids b where a.k = 'sp1' and b.k = 'sp1b'), 'paying 50 leaves 100.00, and a retry returns the same payment');
select t.ok((select balance = 100.00 from public.list_suppliers('aaaaaaaa-0000-0000-0000-000000000001', 'square')), 'the retry did not pay twice');
select t.ok((select count(*) = 1 and max(amount) = 50.00 and max(method) = 'BANK' from public.payments where supplier_id = 'a1000000-0000-0000-0000-0000000000f1' and purchase_id is null), 'the standalone payment is recorded against the supplier only');
insert into ids values ('sp2', pg_temp.pay('a1000000-0000-0000-0000-0000000000f1', '100.00'));
select t.ok((select v ->> 'balance_after' = '0.00' from ids where k = 'sp2'), 'paying exactly what is owed clears it');
select t.throws(format('select pg_temp.pay(%L, ''0.01'')', 'a1000000-0000-0000-0000-0000000000f1'), 'PH060', 'nothing more can be paid once cleared');
select t.owner();
select t.login('a4000000-0000-0000-0000-000000000001');
select t.throws(format('select pg_temp.pay(%L, ''1'')', 'a2000000-0000-0000-0000-0000000000f1'), '42501', 'a cashier cannot pay a supplier');
select t.owner();

-- ---- statements, summary and the due list -------------------------------------------------------------------------------
insert into public.suppliers (id, branch_id, name) values ('a4000000-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-000000000001', 'Boundary');
insert into public.supplier_ledger_entries (branch_id, supplier_id, entry_type, amount, created_at) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-0000000000f1', 'PURCHASE_DUE', 300, '2026-08-10 12:00:00+06'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-0000000000f1', 'PURCHASE_DUE',  40, '2026-08-31 23:59:59+06'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-0000000000f1', 'PURCHASE_DUE',  60, '2026-09-01 00:00:00+06'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-0000000000f1', 'PAYMENT',     -100, '2026-09-20 12:00:00+06');
select t.login('a1000000-0000-0000-0000-000000000001');
select t.ok((select s ->> 'opening' = '340.00' and s ->> 'closing' = '300.00' and s ->> 'total_charges' = '60.00' and s ->> 'total_credits' = '100.00'
                and (s ->> 'entry_count')::int = 2 and s -> 'entries' -> 0 ->> 'running' = '400.00' and s -> 'entries' -> 1 ->> 'running' = '300.00'
               from (select public.supplier_statement('aaaaaaaa-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-0000000000f1', '2026-09-01', '2026-09-30') s) q),
  'September: opening 340 (an entry at 23:59:59 on 31 Aug is August), +60, -100, closing 300');
select t.ok((select s ->> 'opening' = '0.00' and s ->> 'closing' = '340.00'
               from (select public.supplier_statement('aaaaaaaa-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-0000000000f1', '2026-08-01', '2026-08-31') s) q), 'August closes at 340');
select t.ok((select s -> 'entries' -> 0 ->> 'purchase_no' = 'PUR-000001' and s -> 'entries' -> 1 ->> 'method' = 'CASH' and s -> 'entries' -> 0 ->> 'supplier_invoice_no' = 'SQ-1001'
               from (select public.supplier_statement('aaaaaaaa-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-0000000000f1', current_date - 1, current_date + 1) s) q),
  'a statement names the purchase and the payment method');
select t.throws('select public.supplier_statement(''aaaaaaaa-0000-0000-0000-000000000001'', ''a1000000-0000-0000-0000-0000000000f1'', ''2026-09-30'', ''2026-09-01'')', '22023', 'a backwards range is refused');
select t.throws('select public.supplier_statement(''aaaaaaaa-0000-0000-0000-000000000001'', ''b1000000-0000-0000-0000-0000000000f1'', ''2026-09-01'', ''2026-09-30'')', 'P0002', 'another branch''s supplier is not found');
-- owed now: Boundary 300; Beximco: 5.00 (invoice SQ-1001 unpaid; the BX-77 purchase was paid in full); Square 0
select t.ok((select total_payable = 305.00 and suppliers_with_due = 2 and active_suppliers = 4 and advance_total = 0 from public.supplier_due_summary('aaaaaaaa-0000-0000-0000-000000000001')),
  'due summary: 305.00 owed by 2 suppliers');
select t.ok((select array_agg(name order by balance desc) = array['Boundary','Beximco'] from public.list_suppliers('aaaaaaaa-0000-0000-0000-000000000001', '', 'due')), 'the due list is largest first');
select t.ok((select array_agg(name) = array['Closed'] from public.list_suppliers('aaaaaaaa-0000-0000-0000-000000000001', '', 'inactive')), 'inactive filter');
select t.throws('select * from public.list_suppliers(''aaaaaaaa-0000-0000-0000-000000000001'', '''', ''bogus'')', '22023', 'an unknown filter is refused');
select t.ok((public.supplier_summary('aaaaaaaa-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-0000000000f1') ->> 'purchases_count') = '5'
        and (public.supplier_summary('aaaaaaaa-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-0000000000f1') ->> 'can_pay') = 'true'
        and (public.supplier_summary('aaaaaaaa-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-0000000000f1') ->> 'balance') = '0.00',
  'supplier summary: purchase count, balance and what the user may do');
select t.ok(public.supplier_summary('aaaaaaaa-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-0000000000f1') is null, 'a Branch B supplier reads as not found');
select t.owner();

-- ---- tables: visibility and immutability ---------------------------------------------------------------------------------
select t.login('a4000000-0000-0000-0000-000000000001'); -- cashier: sale.create, no supplier.view
select t.ok(t.count('select 1 from public.payments where direction = ''OUT''') = 0, 'a cashier cannot see money paid out to suppliers');
select t.throws('delete from public.purchases', '42501', 'a cashier cannot delete purchases');
select t.throws('insert into public.supplier_ledger_entries (branch_id, supplier_id, entry_type, amount) values (''aaaaaaaa-0000-0000-0000-000000000001'', ''a1000000-0000-0000-0000-0000000000f1'', ''PAYMENT'', -1)', '42501', 'a cashier cannot write supplier ledger entries');
select t.owner();
select t.login('a1000000-0000-0000-0000-000000000001');
select t.ok(t.count('select 1 from public.payments where direction = ''OUT''') >= 3, 'an admin sees money paid out');
select t.throws('insert into public.purchases (branch_id, purchase_seq, purchase_no, supplier_id, supplier_invoice_no, invoice_date, subtotal, discount_total, tax_total, grand_total, paid_total, due_total, client_request_id) values (''aaaaaaaa-0000-0000-0000-000000000001'', 999, ''X'', ''a1000000-0000-0000-0000-0000000000f1'', ''X'', current_date, 1, 0, 0, 1, 0, 1, gen_random_uuid())', '42501', 'even an admin cannot insert a purchase directly');
select t.owner();
select t.throws('update public.purchases set notes = ''x''', 'PH010', 'a purchase cannot be edited');
select t.throws('delete from public.purchase_items', 'PH010', 'a purchase line cannot be deleted');
select t.throws('update public.supplier_ledger_entries set amount = 1', 'PH010', 'supplier ledger entries cannot be edited');
select t.throws('delete from public.supplier_ledger_entries', 'PH010', 'supplier ledger entries cannot be deleted');
select t.throws('truncate public.purchases', '0A000', 'purchases cannot be truncated while their lines reference them');
select t.throws('insert into public.payments (branch_id, direction, method, amount, customer_id) values (''aaaaaaaa-0000-0000-0000-000000000001'', ''OUT'', ''CASH'', 1, ''c9000000-0000-0000-0000-0000000000f1'')', '23514', 'money out must name a supplier, not a customer');
select t.throws('insert into public.payments (branch_id, direction, method, amount, supplier_id) values (''aaaaaaaa-0000-0000-0000-000000000001'', ''IN'', ''CASH'', 1, ''a1000000-0000-0000-0000-0000000000f1'')', '23514', 'money in never names a supplier');

-- ---- the invariant, the audit trail ---------------------------------------------------------------------------------------
set constraints all immediate;
select t.ok(true, 'every batch still equals the sum of its movements at commit');
select t.login('a1000000-0000-0000-0000-000000000001');
select t.ok((select count(*) = 0 from public.stock_reconciliation('aaaaaaaa-0000-0000-0000-000000000001')), 'reconciliation shows no drift after all the purchases');
select t.owner();
select t.ok((select count(*) = 1 and max(new_values ->> 'grand_total') = '100.00' and max(new_values ->> 'due_total') = '60.00'
               from public.audit_log where action = 'purchase.create' and entity_id = (select v ->> 'purchase_id' from ids where k = 'p1')
                and actor_id = 'a1000000-0000-0000-0000-000000000001'), 'each purchase is audited with its actor and totals');
select t.ok((select count(*) = 2 from public.audit_log where action = 'supplier.payment' and actor_id = 'a1000000-0000-0000-0000-000000000001'), 'each supplier payment is audited once (the retry added none)');
select t.ok((select count(*) = 1 from public.audit_log where action = 'suppliers.insert' and new_values ->> 'name' = 'Incepta'), 'supplier changes are audited like other master data');

rollback;
