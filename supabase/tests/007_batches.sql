-- Batches, stock movements, the stock invariant, cost privacy and FEFO listing.
begin;

-- Fixture medicines (owner inserts bypass the RPCs; that is fine for setup).
insert into public.medicines (id, name, default_sale_price, mrp) values
  ('e1000000-0000-0000-0000-000000000001', 'Napa 500mg', 1.50, 2.00),
  ('e2000000-0000-0000-0000-000000000001', 'Ace 500mg', 1.20, 2.00),
  ('e3000000-0000-0000-0000-000000000001', 'Retired', 1.00, 2.00);
update public.medicines set is_active = false where id = 'e3000000-0000-0000-0000-000000000001';

create temp table ids (k text primary key, v uuid) on commit drop;
grant all on ids to authenticated;

-- ---- permissions -------------------------------------------------------------
select t.login('a4000000-0000-0000-0000-000000000001'); -- cashier: no batch.edit
select t.throws(format('select public.create_batch(jsonb_build_object(''branch_id'', %L, ''medicine_id'', %L, ''batch_number'', ''B1'', ''expiry_date'', (current_date + 400)::text, ''purchase_price'', ''1.10'', ''sale_price'', ''1.50'', ''quantity'', 40))',
  'aaaaaaaa-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001'), '42501', 'cashier cannot create a batch');
select t.throws('insert into public.medicine_batches (branch_id, medicine_id, batch_number, expiry_date, purchase_price, sale_price) values (''aaaaaaaa-0000-0000-0000-000000000001'', ''e1000000-0000-0000-0000-000000000001'', ''B'', current_date + 9, 1, 1)',
  '42501', 'no direct insert into batches');
select t.throws('insert into public.stock_movements (branch_id, medicine_id, batch_id, quantity_delta, movement_type) values (null, null, null, 5, ''PURCHASE'')',
  '42501', 'no direct insert into stock movements');
select t.owner();

select t.login('b1000000-0000-0000-0000-000000000001'); -- admin of Branch B
select t.throws(format('select public.create_batch(jsonb_build_object(''branch_id'', %L, ''medicine_id'', %L, ''batch_number'', ''B1'', ''expiry_date'', (current_date + 400)::text, ''purchase_price'', ''1.10'', ''sale_price'', ''1.50'', ''quantity'', 40))',
  'aaaaaaaa-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001'), '42501', 'admin B cannot create a batch in Branch A');
select t.owner();

-- ---- creating batches (pharmacist: batch.edit + stock.adjust) -----------------
select t.login('a3000000-0000-0000-0000-000000000001');

-- The brief's example: two Napa batches that must stay separate.
insert into ids values ('a', public.create_batch(jsonb_build_object(
  'branch_id', 'aaaaaaaa-0000-0000-0000-000000000001', 'medicine_id', 'e1000000-0000-0000-0000-000000000001',
  'batch_number', 'A', 'expiry_date', (current_date + 200)::text,
  'purchase_price', '1.10', 'sale_price', '1.50', 'mrp', '2.00', 'quantity', 40)));
insert into ids values ('b', public.create_batch(jsonb_build_object(
  'branch_id', 'aaaaaaaa-0000-0000-0000-000000000001', 'medicine_id', 'e1000000-0000-0000-0000-000000000001',
  'batch_number', 'B', 'expiry_date', (current_date + 400)::text,
  'purchase_price', '1.20', 'sale_price', '1.50', 'mrp', '2.00', 'quantity', 100)));
select t.owner();

select t.ok((select count(*) = 2 from public.medicine_batches where medicine_id = 'e1000000-0000-0000-0000-000000000001'),
  'two batches of one medicine stay separate');
select t.ok((select quantity = 40 from public.medicine_batches where id = (select v from ids where k = 'a')), 'batch A holds 40');
select t.ok((select quantity = 100 from public.medicine_batches where id = (select v from ids where k = 'b')), 'batch B holds 100');
select t.ok((select count(*) = 1 from public.stock_movements
              where batch_id = (select v from ids where k = 'a') and movement_type = 'OPENING_STOCK'
                and quantity_delta = 40 and reference_type = 'batch'
                and user_id = 'a3000000-0000-0000-0000-000000000001'),
  'creating a batch writes an OPENING_STOCK movement for the same quantity and the actor');
select t.ok((select purchase_price = 1.10 from public.medicine_batches where id = (select v from ids where k = 'a'))
        and (select purchase_price = 1.20 from public.medicine_batches where id = (select v from ids where k = 'b')),
  'each batch keeps its own cost');
select t.ok((select count(*) = 2 from public.audit_log where action = 'medicine_batches.insert'
              and branch_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'batch creation is audited per branch');

select t.login('a3000000-0000-0000-0000-000000000001');
select t.throws(format('select public.create_batch(jsonb_build_object(''branch_id'', %L, ''medicine_id'', %L, ''batch_number'', ''A'', ''expiry_date'', (current_date + 200)::text, ''purchase_price'', ''9'', ''sale_price'', ''1.50'', ''quantity'', 5))',
  'aaaaaaaa-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001'), '23505',
  'the same medicine, batch number and expiry cannot be created twice (null supplier included)');
select t.ok(t.count(format('select 1 from public.medicine_batches where medicine_id = %L', 'e1000000-0000-0000-0000-000000000001')) = 2,
  'a rejected duplicate leaves nothing behind');

-- Same batch number, other medicine: allowed. Same number, other expiry: separate batch.
select public.create_batch(jsonb_build_object(
  'branch_id', 'aaaaaaaa-0000-0000-0000-000000000001', 'medicine_id', 'e2000000-0000-0000-0000-000000000001',
  'batch_number', 'A', 'expiry_date', (current_date + 200)::text, 'purchase_price', '0.90', 'sale_price', '1.20', 'quantity', 10));
select public.create_batch(jsonb_build_object(
  'branch_id', 'aaaaaaaa-0000-0000-0000-000000000001', 'medicine_id', 'e1000000-0000-0000-0000-000000000001',
  'batch_number', 'A', 'expiry_date', (current_date + 300)::text, 'purchase_price', '1.15', 'sale_price', '1.50', 'quantity', 7));
select t.ok(true, 'batch numbers are not globally unique');

-- Validation
select t.throws(format('select public.create_batch(jsonb_build_object(''branch_id'', %L, ''medicine_id'', %L, ''batch_number'', ''X'', ''expiry_date'', current_date::text, ''purchase_price'', ''1'', ''sale_price'', ''1'', ''quantity'', 5))',
  'aaaaaaaa-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001'), 'PH030', 'a batch expiring today is expired and cannot be added');
select t.throws(format('select public.create_batch(jsonb_build_object(''branch_id'', %L, ''medicine_id'', %L, ''batch_number'', ''X'', ''expiry_date'', (current_date - 30)::text, ''purchase_price'', ''1'', ''sale_price'', ''1'', ''quantity'', 5))',
  'aaaaaaaa-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001'), 'PH030', 'a past expiry is rejected');
select public.create_batch(jsonb_build_object(
  'branch_id', 'aaaaaaaa-0000-0000-0000-000000000001', 'medicine_id', 'e1000000-0000-0000-0000-000000000001',
  'batch_number', 'TOMORROW', 'expiry_date', (current_date + 1)::text, 'purchase_price', '1', 'sale_price', '1', 'quantity', 5));
select t.ok(true, 'a batch expiring tomorrow is accepted');
select t.throws(format('select public.create_batch(jsonb_build_object(''branch_id'', %L, ''medicine_id'', %L, ''batch_number'', ''X'', ''expiry_date'', (current_date + 90)::text, ''purchase_price'', ''1'', ''sale_price'', ''3'', ''mrp'', ''2'', ''quantity'', 5))',
  'aaaaaaaa-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001'), 'PH031', 'a sale price above the MRP is rejected');
select t.throws(format('select public.create_batch(jsonb_build_object(''branch_id'', %L, ''medicine_id'', %L, ''batch_number'', ''X'', ''expiry_date'', (current_date + 90)::text, ''purchase_price'', ''1'', ''sale_price'', ''1'', ''quantity'', 0))',
  'aaaaaaaa-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001'), '23514', 'zero opening quantity is rejected');
select t.throws(format('select public.create_batch(jsonb_build_object(''branch_id'', %L, ''medicine_id'', %L, ''batch_number'', ''X'', ''expiry_date'', (current_date + 90)::text, ''purchase_price'', ''1'', ''sale_price'', ''1'', ''quantity'', 5, ''supplier_id'', %L))',
  'aaaaaaaa-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', gen_random_uuid()), '22023', 'unknown fields (supplier arrives in Phase 7) are rejected');
select t.throws(format('select public.create_batch(jsonb_build_object(''branch_id'', %L, ''medicine_id'', %L, ''batch_number'', ''X'', ''expiry_date'', (current_date + 90)::text, ''sale_price'', ''1'', ''quantity'', 5))',
  'aaaaaaaa-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001'), '22023', 'missing required fields are named and rejected');
select t.throws(format('select public.create_batch(jsonb_build_object(''branch_id'', %L, ''medicine_id'', %L, ''batch_number'', ''X'', ''expiry_date'', ''not-a-date'', ''purchase_price'', ''1'', ''sale_price'', ''1'', ''quantity'', 5))',
  'aaaaaaaa-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001'), '22007', 'a malformed date is rejected');
select t.throws(format('select public.create_batch(jsonb_build_object(''branch_id'', %L, ''medicine_id'', %L, ''batch_number'', ''X'', ''expiry_date'', (current_date + 90)::text, ''purchase_price'', ''1'', ''sale_price'', ''1'', ''quantity'', 5))',
  'aaaaaaaa-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000001'), 'P0002', 'an inactive medicine cannot receive stock');
select t.owner();

-- ---- stock invariant -------------------------------------------------------------
-- Setup ran as one transaction; run the deferred checks now.
set constraints all immediate;
select t.ok(true, 'RPC-created batches satisfy the invariant at commit');

select t.throws(format('update public.medicine_batches set quantity = quantity + 1 where id = %L', (select v from ids where k = 'a')),
  'PH040', 'raising a batch quantity without a movement is refused');
set constraints all deferred;

select t.throws(format('insert into public.stock_movements (branch_id, medicine_id, batch_id, quantity_delta, movement_type, reason) values (%L, %L, %L, -3, ''DAMAGE'', ''broken'')',
  'aaaaaaaa-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', (select v from ids where k = 'a')) || '; set constraints all immediate',
  'PH040', 'a movement without the matching quantity change is refused');
set constraints all deferred;

-- Doing both together is fine.
update public.medicine_batches set quantity = quantity - 3 where id = (select v from ids where k = 'a');
insert into public.stock_movements (branch_id, medicine_id, batch_id, quantity_delta, movement_type, reason)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', (select v from ids where k = 'a'), -3, 'DAMAGE', 'broken in transit');
set constraints all immediate;
select t.ok((select quantity = 37 from public.medicine_batches where id = (select v from ids where k = 'a')), 'a matched quantity change and movement is accepted');
set constraints all deferred;

-- Movement rules
select t.throws(format('insert into public.stock_movements (branch_id, medicine_id, batch_id, quantity_delta, movement_type) values (%L, %L, %L, 0, ''ADJUSTMENT'')',
  'aaaaaaaa-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', (select v from ids where k = 'a')), '23514', 'a zero movement is rejected');
select t.throws(format('insert into public.stock_movements (branch_id, medicine_id, batch_id, quantity_delta, movement_type, reason) values (%L, %L, %L, 5, ''SALE'', ''x'')',
  'aaaaaaaa-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', (select v from ids where k = 'a')), '23514', 'a SALE movement must reduce stock');
select t.throws(format('insert into public.stock_movements (branch_id, medicine_id, batch_id, quantity_delta, movement_type) values (%L, %L, %L, 5, ''PURCHASE_RETURN'')',
  'aaaaaaaa-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', (select v from ids where k = 'a')), '23514', 'a PURCHASE_RETURN must reduce stock');
select t.throws(format('insert into public.stock_movements (branch_id, medicine_id, batch_id, quantity_delta, movement_type) values (%L, %L, %L, -1, ''ADJUSTMENT'')',
  'aaaaaaaa-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', (select v from ids where k = 'a')), '23514', 'an adjustment must give a reason');
select t.throws(format('insert into public.stock_movements (branch_id, medicine_id, batch_id, quantity_delta, movement_type) values (%L, %L, %L, 5, ''MAGIC'')',
  'aaaaaaaa-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', (select v from ids where k = 'a')), '23514', 'an unknown movement type is rejected');
select t.throws(format('insert into public.stock_movements (branch_id, medicine_id, batch_id, quantity_delta, movement_type) values (%L, %L, %L, 5, ''PURCHASE'')',
  'bbbbbbbb-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', (select v from ids where k = 'a')), '23503', 'a movement must name the batch''s own branch');
select t.throws(format('insert into public.stock_movements (branch_id, medicine_id, batch_id, quantity_delta, movement_type) values (%L, %L, %L, 5, ''PURCHASE'')',
  'aaaaaaaa-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', (select v from ids where k = 'a')), '23503', 'a movement must name the batch''s own medicine');
select t.throws('update public.stock_movements set quantity_delta = 99', 'PH010', 'stock movements cannot be edited');
select t.throws('delete from public.stock_movements', 'PH010', 'stock movements cannot be deleted');
select t.throws('truncate public.stock_movements', 'PH010', 'stock movements cannot be truncated');
select t.throws(format('update public.medicine_batches set quantity = -1 where id = %L', (select v from ids where k = 'a')), '23514', 'a negative batch quantity is rejected');

-- ---- listing: FEFO order, expiry flags, cost privacy -----------------------------
select t.login('a4000000-0000-0000-0000-000000000001'); -- cashier
select t.ok((select array_agg(batch_number order by expiry_date) from public.list_batches('aaaaaaaa-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001'))
          = (select array_agg(batch_number) from public.list_batches('aaaaaaaa-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001')),
  'list_batches returns batches in FEFO order');
select t.ok((select batch_number from public.list_batches('aaaaaaaa-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001') limit 1) = 'TOMORROW',
  'the earliest-expiring batch is first');
select t.ok((select days_to_expiry = 1 and not is_expired from public.list_batches('aaaaaaaa-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001') limit 1),
  'days_to_expiry is computed in the branch timezone');
select t.ok((select bool_and(purchase_price is null) from public.list_batches('aaaaaaaa-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001')),
  'the cashier gets no cost from list_batches');
select t.throws('select purchase_price from public.medicine_batches', '42501', 'the cashier cannot select the batch cost column');
select t.ok(t.count('select batch_number, expiry_date, sale_price, quantity from public.medicine_batches') = 5, 'the cashier can read batch stock without cost');
select t.ok(t.count('select 1 from public.stock_movements') = 6, 'the cashier can read movements (no cost in them)');
select t.owner();

select t.login('a2000000-0000-0000-0000-000000000001'); -- manager: purchase.view_cost
select t.ok((select purchase_price = 1.10 from public.list_batches('aaaaaaaa-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001') where batch_number = 'A' and days_to_expiry = 200),
  'the manager sees each batch''s own cost');
select t.owner();

-- Branch isolation
select t.login('b1000000-0000-0000-0000-000000000001');
select t.throws('select * from public.list_batches(''aaaaaaaa-0000-0000-0000-000000000001'', ''e1000000-0000-0000-0000-000000000001'')', '42501', 'admin B cannot list Branch A batches');
select t.ok(t.count('select 1 from public.medicine_batches') = 0, 'admin B sees no Branch A batches');
select t.ok(t.count('select 1 from public.stock_movements') = 0, 'admin B sees no Branch A movements');
select t.owner();

-- ---- stock in search results ---------------------------------------------------------
select t.login('a4000000-0000-0000-0000-000000000001');
select t.ok((select stock_on_hand from public.search_medicines('aaaaaaaa-0000-0000-0000-000000000001', 'napa 500') limit 1) = 37 + 100 + 7 + 5,
  'search reports stock on hand as the sum of unexpired batches');
select t.owner();
-- Make one batch expire today (in the branch timezone): it stops counting.
alter table public.medicine_batches disable trigger medicine_batches_audit;
update public.medicine_batches set expiry_date = (now() at time zone 'Asia/Dhaka')::date where batch_number = 'TOMORROW';
alter table public.medicine_batches enable trigger medicine_batches_audit;
select t.login('a4000000-0000-0000-0000-000000000001');
select t.ok((select stock_on_hand from public.search_medicines('aaaaaaaa-0000-0000-0000-000000000001', 'napa 500') limit 1) = 37 + 100 + 7,
  'a batch expiring today no longer counts as stock');
select t.ok((select is_expired from public.list_batches('aaaaaaaa-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001') where batch_number = 'TOMORROW'),
  'a batch expiring today is flagged expired');
select t.owner();

-- ---- price corrections --------------------------------------------------------------
select t.login('a3000000-0000-0000-0000-000000000001'); -- pharmacist: no price.edit
select t.throws(format('select public.update_batch_prices(%L, 1.40, 2.00)', (select v from ids where k = 'a')), '42501', 'pharmacist cannot change batch prices');
select t.owner();
select t.login('a1000000-0000-0000-0000-000000000001'); -- admin
select public.update_batch_prices((select v from ids where k = 'a'), 1.40, 2.00);
select t.throws(format('select public.update_batch_prices(%L, 3.00, 2.00)', (select v from ids where k = 'a')), 'PH031', 'a batch sale price above MRP is rejected');
select t.throws('select public.update_batch_prices(gen_random_uuid(), 1, 2)', 'P0002', 'updating a missing batch fails');
select t.owner();
select t.ok((select sale_price = 1.40 and purchase_price = 1.10 from public.medicine_batches where id = (select v from ids where k = 'a')),
  'a price correction changes the sale price and never the cost');
select t.ok((select count(*) = 1 from public.audit_log
              where action = 'medicine_batches.update' and entity_id = (select v::text from ids where k = 'a')
                and old_values ->> 'sale_price' = '1.5000' and new_values ->> 'sale_price' = '1.4000'),
  'a batch price correction is audited with old and new values');

rollback;
