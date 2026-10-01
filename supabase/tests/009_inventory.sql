-- Inventory: adjustments, write-offs, stock list, expiry buckets, movements, reconciliation.
begin;

create temp table ids (k text primary key, v uuid) on commit drop;
grant all on ids to authenticated;

-- ---- fixtures (Branch A) ----------------------------------------------------------
insert into public.medicines (id, name, reorder_level, is_active) values
  ('f1000000-0000-0000-0000-000000000001', 'Napa',     50,  true),
  ('f2000000-0000-0000-0000-000000000001', 'Zimax',    20,  true),
  ('f3000000-0000-0000-0000-000000000001', 'Losectil', 100, true),
  ('f4000000-0000-0000-0000-000000000001', 'Xylo',     0,   true),
  ('f5000000-0000-0000-0000-000000000001', 'Empty',    10,  true),
  ('f6000000-0000-0000-0000-000000000001', 'Retired',  0,   true),
  ('f7000000-0000-0000-0000-000000000001', 'Boundary', 0,   true);

select t.login('a3000000-0000-0000-0000-000000000001'); -- pharmacist creates batches
create function pg_temp.mk(p_key text, p_med text, p_batch text, p_days integer, p_qty integer, p_cost text) returns void
language plpgsql as $f$
begin
  insert into ids values (p_key, public.create_batch(jsonb_build_object(
    'branch_id', 'aaaaaaaa-0000-0000-0000-000000000001', 'medicine_id', p_med::uuid,
    'batch_number', p_batch, 'expiry_date', (current_date + p_days)::text,
    'purchase_price', p_cost, 'sale_price', '5', 'quantity', p_qty)));
end $f$;
grant execute on function pg_temp.mk(text, text, text, integer, integer, text) to authenticated;

select pg_temp.mk('n1', 'f1000000-0000-0000-0000-000000000001', 'N1', 200, 40, '1.10');
select pg_temp.mk('n2', 'f1000000-0000-0000-0000-000000000001', 'N2', 400, 100, '1.20');
select pg_temp.mk('z1', 'f2000000-0000-0000-0000-000000000001', 'Z1', 20, 10, '2.00');
select pg_temp.mk('l1', 'f3000000-0000-0000-0000-000000000001', 'L1', 300, 30, '0.50');
select pg_temp.mk('x1', 'f4000000-0000-0000-0000-000000000001', 'X1', 5, 5, '3.00');
select pg_temp.mk('r1', 'f6000000-0000-0000-0000-000000000001', 'R1', 300, 7, '1.00');
select pg_temp.mk('b01', 'f7000000-0000-0000-0000-000000000001', 'B01', 1, 1, '1.00');
select pg_temp.mk('b30', 'f7000000-0000-0000-0000-000000000001', 'B30', 30, 1, '1.00');
select pg_temp.mk('b31', 'f7000000-0000-0000-0000-000000000001', 'B31', 31, 1, '1.00');
select pg_temp.mk('b60', 'f7000000-0000-0000-0000-000000000001', 'B60', 60, 1, '1.00');
select pg_temp.mk('b61', 'f7000000-0000-0000-0000-000000000001', 'B61', 61, 1, '1.00');
select pg_temp.mk('b90', 'f7000000-0000-0000-0000-000000000001', 'B90', 90, 1, '1.00');
select pg_temp.mk('b91', 'f7000000-0000-0000-0000-000000000001', 'B91', 91, 1, '1.00');
select pg_temp.mk('bt', 'f7000000-0000-0000-0000-000000000001', 'BTODAY', 2, 1, '1.00');
select pg_temp.mk('bp', 'f7000000-0000-0000-0000-000000000001', 'BPAST', 2, 1, '1.00');
select t.owner();

-- Time passes: some batches expire (setup only; the app can't move expiry dates).
update public.medicines set is_active = false where id = 'f6000000-0000-0000-0000-000000000001';
update public.medicine_batches set expiry_date = (now() at time zone 'Asia/Dhaka')::date
 where id in ((select v from ids where k = 'x1'), (select v from ids where k = 'bt'));
update public.medicine_batches set expiry_date = (now() at time zone 'Asia/Dhaka')::date - 5
 where id = (select v from ids where k = 'bp');
set constraints all immediate;
select t.ok(true, 'fixtures satisfy the stock invariant');
set constraints all deferred;

-- ---- adjust_stock ---------------------------------------------------------------------
select t.login('a4000000-0000-0000-0000-000000000001'); -- cashier
select t.throws(format('select public.adjust_stock(jsonb_build_object(''batch_id'', %L, ''movement_type'', ''ADJUSTMENT'', ''quantity_delta'', -1, ''reason'', ''x''))', (select v from ids where k = 'n1')),
  '42501', 'cashier cannot adjust stock');
select t.owner();
select t.login('b1000000-0000-0000-0000-000000000001'); -- admin B
select t.throws(format('select public.adjust_stock(jsonb_build_object(''batch_id'', %L, ''movement_type'', ''ADJUSTMENT'', ''quantity_delta'', -1, ''reason'', ''x''))', (select v from ids where k = 'n1')),
  '42501', 'admin B cannot adjust Branch A stock');
select t.owner();

select t.login('a3000000-0000-0000-0000-000000000001'); -- pharmacist
select public.adjust_stock(jsonb_build_object('batch_id', (select v from ids where k = 'n1'), 'movement_type', 'ADJUSTMENT', 'quantity_delta', -3, 'reason', 'Count was short'));
select t.ok((select quantity = 37 from public.medicine_batches where id = (select v from ids where k = 'n1')), 'a negative adjustment reduces the batch');
select public.adjust_stock(jsonb_build_object('batch_id', (select v from ids where k = 'n1'), 'movement_type', 'CORRECTION', 'quantity_delta', 5, 'reason', 'Found a box'));
select t.ok((select quantity = 42 from public.medicine_batches where id = (select v from ids where k = 'n1')), 'a positive correction increases the batch');
select public.adjust_stock(jsonb_build_object('batch_id', (select v from ids where k = 'n1'), 'movement_type', 'DAMAGE', 'quantity_delta', -2, 'reason', 'Dropped'));
select t.ok((select quantity = 40 from public.medicine_batches where id = (select v from ids where k = 'n1')), 'damage reduces the batch');
select t.ok((select count(*) = 3 and sum(quantity_delta) = 0 from public.stock_movements
              where batch_id = (select v from ids where k = 'n1') and movement_type <> 'OPENING_STOCK'),
  'each adjustment wrote its own movement, with the reason');
select t.ok((select reason = 'Count was short' and user_id = 'a3000000-0000-0000-0000-000000000001' and reference_type = 'adjustment'
               from public.stock_movements where movement_type = 'ADJUSTMENT' and batch_id = (select v from ids where k = 'n1')),
  'the movement records the reason and the actor');

select t.throws(format('select public.adjust_stock(jsonb_build_object(''batch_id'', %L, ''movement_type'', ''ADJUSTMENT'', ''quantity_delta'', -1, ''reason'', ''   ''))', (select v from ids where k = 'n1')),
  '23514', 'a blank reason is rejected');
select t.throws(format('select public.adjust_stock(jsonb_build_object(''batch_id'', %L, ''movement_type'', ''ADJUSTMENT'', ''quantity_delta'', 0, ''reason'', ''x''))', (select v from ids where k = 'n1')),
  '23514', 'a zero adjustment is rejected');
select t.throws(format('select public.adjust_stock(jsonb_build_object(''batch_id'', %L, ''movement_type'', ''DAMAGE'', ''quantity_delta'', 1, ''reason'', ''x''))', (select v from ids where k = 'n1')),
  '23514', 'damage cannot add stock');
select t.throws(format('select public.adjust_stock(jsonb_build_object(''batch_id'', %L, ''movement_type'', ''SALE'', ''quantity_delta'', -1, ''reason'', ''x''))', (select v from ids where k = 'n1')),
  '22023', 'a SALE cannot be recorded as a manual adjustment');
select t.throws(format('select public.adjust_stock(jsonb_build_object(''batch_id'', %L, ''movement_type'', ''ADJUSTMENT'', ''quantity_delta'', -1000, ''reason'', ''x''))', (select v from ids where k = 'n1')),
  'PH041', 'removing more than is on hand is refused');
select t.ok((select quantity = 40 from public.medicine_batches where id = (select v from ids where k = 'n1')), 'a refused adjustment changes nothing');
select t.throws(format('select public.adjust_stock(jsonb_build_object(''batch_id'', %L, ''movement_type'', ''EXPIRED'', ''quantity_delta'', -1, ''reason'', ''x''))', (select v from ids where k = 'n1')),
  'PH042', 'an unexpired batch cannot be written off as EXPIRED');
select t.throws('select public.adjust_stock(''{"batch_id":"00000000-0000-0000-0000-00000000dead","movement_type":"ADJUSTMENT","quantity_delta":-1,"reason":"x"}''::jsonb)',
  'P0002', 'a missing batch is reported');
select t.throws(format('select public.adjust_stock(jsonb_build_object(''batch_id'', %L, ''movement_type'', ''ADJUSTMENT'', ''quantity_delta'', -1, ''reason'', ''x'', ''colour'', ''red''))', (select v from ids where k = 'n1')),
  '22023', 'unknown fields are rejected');
select t.throws(format('select public.adjust_stock(jsonb_build_object(''batch_id'', %L, ''movement_type'', ''ADJUSTMENT'', ''quantity_delta'', -1))', (select v from ids where k = 'n1')),
  '22023', 'a missing reason field is named and rejected');

-- EXPIRED works once the batch has expired.
select public.adjust_stock(jsonb_build_object('batch_id', (select v from ids where k = 'x1'), 'movement_type', 'EXPIRED', 'quantity_delta', -5, 'reason', 'Past date'));
select t.ok((select quantity = 0 from public.medicine_batches where id = (select v from ids where k = 'x1')), 'an expired batch can be written off with EXPIRED');

-- Idempotency: a retried submit adjusts once.
select public.adjust_stock(jsonb_build_object('batch_id', (select v from ids where k = 'l1'), 'movement_type', 'ADJUSTMENT', 'quantity_delta', -4, 'reason', 'Count', 'client_request_id', '99999999-0000-0000-0000-000000000001'));
select public.adjust_stock(jsonb_build_object('batch_id', (select v from ids where k = 'l1'), 'movement_type', 'ADJUSTMENT', 'quantity_delta', -4, 'reason', 'Count', 'client_request_id', '99999999-0000-0000-0000-000000000001'));
select t.ok((select quantity = 26 from public.medicine_batches where id = (select v from ids where k = 'l1')), 'a repeated client_request_id adjusts only once');
select t.ok((select count(*) = 1 from public.stock_movements where client_request_id = '99999999-0000-0000-0000-000000000001'), 'and writes one movement');
select t.owner();

select t.ok((select count(*) = 1 from public.audit_log
              where action = 'medicine_batches.update' and entity_id = (select v::text from ids where k = 'x1')
                and old_values ->> 'quantity' = '5' and new_values ->> 'quantity' = '0'),
  'a stock change is audited with old and new quantity');

-- ---- write_off_expired -------------------------------------------------------------------
select t.login('a4000000-0000-0000-0000-000000000001');
select t.throws(format('select public.write_off_expired(%L, array[%L]::uuid[])', 'aaaaaaaa-0000-0000-0000-000000000001', (select v from ids where k = 'bp')),
  '42501', 'cashier cannot write off stock');
select t.owner();

select t.login('a3000000-0000-0000-0000-000000000001');
select t.throws(format('select public.write_off_expired(%L, array[%L, %L]::uuid[])', 'aaaaaaaa-0000-0000-0000-000000000001', (select v from ids where k = 'bp'), (select v from ids where k = 'n1')),
  'PH042', 'a list that includes an unexpired batch is refused');
select t.ok((select quantity = 1 from public.medicine_batches where id = (select v from ids where k = 'bp')), 'and nothing was written off');
select t.throws(format('select public.write_off_expired(%L, array[%L]::uuid[])', 'aaaaaaaa-0000-0000-0000-000000000001', gen_random_uuid()),
  'P0002', 'an unknown batch id is refused');
select t.throws(format('select public.write_off_expired(%L, array[]::uuid[])', 'aaaaaaaa-0000-0000-0000-000000000001'),
  '22023', 'an empty list is refused');
select t.ok(public.write_off_expired('aaaaaaaa-0000-0000-0000-000000000001', array[(select v from ids where k = 'bp'), (select v from ids where k = 'bt')]) = 2,
  'write_off_expired returns the units removed');
select t.ok((select count(*) = 2 from public.stock_movements where movement_type = 'EXPIRED' and reference_type = 'write_off'
              and quantity_delta = -1 and reason = 'Expired stock written off'), 'one EXPIRED movement per batch');
select t.throws(format('select public.write_off_expired(%L, array[%L]::uuid[])', 'aaaaaaaa-0000-0000-0000-000000000001', (select v from ids where k = 'bp')),
  'PH043', 'writing off already-empty batches again says there is nothing to write off');
select t.owner();
select t.login('b1000000-0000-0000-0000-000000000001');
select t.throws(format('select public.write_off_expired(%L, array[%L]::uuid[])', 'aaaaaaaa-0000-0000-0000-000000000001', (select v from ids where k = 'bp')),
  '42501', 'admin B cannot write off Branch A stock');
select t.owner();

-- Put the written-off batches' units back so the boundary fixtures stay as designed.
update public.medicine_batches set quantity = 1 where id in ((select v from ids where k = 'bp'), (select v from ids where k = 'bt'));
insert into public.stock_movements (branch_id, medicine_id, batch_id, quantity_delta, movement_type, reason)
select branch_id, medicine_id, id, 1, 'CORRECTION', 'test fixture restore' from public.medicine_batches where id in ((select v from ids where k = 'bp'), (select v from ids where k = 'bt'));
-- And the adjusted batches are back to the figures used below: N1 40, L1 26, X1 0.

-- ---- list_stock ----------------------------------------------------------------------------
select t.login('a4000000-0000-0000-0000-000000000001'); -- cashier (no cost)
create function pg_temp.names(p_filter text, p_days integer default 90) returns text
language sql as $f$
  select coalesce(string_agg(name, ',' order by lower(name)), '')
  from public.list_stock('aaaaaaaa-0000-0000-0000-000000000001', '', p_filter, p_days, 100, 0)
$f$;
grant execute on function pg_temp.names(text, integer) to authenticated;

select t.ok(pg_temp.names('all') = 'Boundary,Empty,Losectil,Napa,Retired,Xylo,Zimax', 'filter all lists every catalogue medicine plus retired ones that still hold stock');
select t.ok(pg_temp.names('in_stock') = 'Boundary,Losectil,Napa,Retired,Zimax', 'in_stock needs sellable units');
select t.ok(pg_temp.names('low') = 'Empty,Losectil,Zimax', 'low = reorder level set and sellable at or below it (out-of-stock included)');
select t.ok(pg_temp.names('out') = 'Xylo', 'out = nothing sellable but stocked before (a never-stocked medicine is not "out")');
select t.ok(pg_temp.names('expiring') = 'Boundary,Zimax', 'expiring (90 days) = nearest sellable batch within the window');
select t.ok(pg_temp.names('expiring', 25) = 'Boundary,Zimax', 'expiring (25 days) still catches +1 and +20');
select t.ok(pg_temp.names('expiring', 10) = 'Boundary', 'expiring (10 days) catches only +1');
select t.ok(pg_temp.names('expired') = 'Boundary', 'expired = holds units past their date');
select t.throws('select * from public.list_stock(''aaaaaaaa-0000-0000-0000-000000000001'', '''', ''bogus'')', '22023', 'an unknown filter is rejected');

select t.ok((select sellable_qty = 140 and expired_qty = 0 and batch_count = 2 and nearest_expiry_days = 200
               from public.list_stock('aaaaaaaa-0000-0000-0000-000000000001', 'napa', 'all') where name = 'Napa'),
  'per-medicine figures: sellable 140 across 2 batches, nearest expiry 200 days');
select t.ok((select sellable_qty = 7 and expired_qty = 2 and nearest_expiry_days = 1
               from public.list_stock('aaaaaaaa-0000-0000-0000-000000000001', 'boundary', 'all')),
  'expired units are kept apart from sellable ones');
select t.ok((select bool_and(value_at_cost is null) from public.list_stock('aaaaaaaa-0000-0000-0000-000000000001', '', 'all')),
  'the cashier gets no stock value');
select t.ok((select max(total_count) = 7 and count(*) = 3 from public.list_stock('aaaaaaaa-0000-0000-0000-000000000001', '', 'all', 90, 3, 0)),
  'paging returns the slice and the total');
select t.ok((select count(*) = 1 from public.list_stock('aaaaaaaa-0000-0000-0000-000000000001', '%', 'all')) = false,
  'a percent sign in the search is literal');
select t.owner();

select t.login('a2000000-0000-0000-0000-000000000001'); -- manager (purchase.view_cost)
select t.ok((select value_at_cost = 164.0000 + 0 from public.list_stock('aaaaaaaa-0000-0000-0000-000000000001', 'napa', 'all') where name = 'Napa'),
  'stock value is exact: 40 x 1.10 + 100 x 1.20 = 164');
select t.owner();
select t.throws('select * from public.list_stock(''bbbbbbbb-0000-0000-0000-000000000001'')', '42501', 'cannot list another branch');

-- ---- inventory_summary ------------------------------------------------------------------------
select t.login('a2000000-0000-0000-0000-000000000001');
select t.ok((select stocked_medicines = 5 and sellable_units = 140 + 10 + 26 + 7 + 7 and low_stock_count = 3 and out_of_stock_count = 1
                    and expiring_30_batches = 3 and expired_batches = 2 and expired_units = 2
               from public.inventory_summary('aaaaaaaa-0000-0000-0000-000000000001')),
  'summary counts match the fixtures');
select t.ok((select value_at_cost = 164 + 20 + 13 + 0 + 7 + 9 and expired_value_at_cost = 2 from public.inventory_summary('aaaaaaaa-0000-0000-0000-000000000001')),
  'summary value and expired value are exact decimals');
select t.ok(
  (select low_stock_count from public.inventory_summary('aaaaaaaa-0000-0000-0000-000000000001'))
    = (select max(total_count) from public.list_stock('aaaaaaaa-0000-0000-0000-000000000001', '', 'low', 90, 100, 0))
  and (select out_of_stock_count from public.inventory_summary('aaaaaaaa-0000-0000-0000-000000000001'))
    = (select max(total_count) from public.list_stock('aaaaaaaa-0000-0000-0000-000000000001', '', 'out', 90, 100, 0))
  and (select stocked_medicines from public.inventory_summary('aaaaaaaa-0000-0000-0000-000000000001'))
    = (select max(total_count) from public.list_stock('aaaaaaaa-0000-0000-0000-000000000001', '', 'in_stock', 90, 100, 0)),
  'the summary agrees with the stock list filters it counts');
select t.owner();
select t.login('a4000000-0000-0000-0000-000000000001');
select t.ok((select value_at_cost is null and expired_value_at_cost is null from public.inventory_summary('aaaaaaaa-0000-0000-0000-000000000001')),
  'the cashier gets counts but no value from the summary');
select t.owner();

-- ---- expiry ------------------------------------------------------------------------------------
select t.login('a4000000-0000-0000-0000-000000000001');
select t.ok((select string_agg(bucket || ':' || batch_count || ':' || units, ',' order by array_position(array['expired','d30','d60','d90'], bucket))
               from public.expiry_buckets('aaaaaaaa-0000-0000-0000-000000000001'))
         = 'expired:2:2,d30:3:12,d60:2:2,d90:2:2',
  'bucket boundaries: today and the past are expired; +1..30, +31..60, +61..90; +91 is outside');
select t.ok((select count(*) = 9 from public.list_expiry('aaaaaaaa-0000-0000-0000-000000000001', 'all')), 'list_expiry all = expired plus the next 90 days');
select t.ok((select array_agg(days_to_expiry order by days_to_expiry) = array[-5, 0, 1, 20, 30, 31, 60, 61, 90]
               from public.list_expiry('aaaaaaaa-0000-0000-0000-000000000001', 'all')), 'list_expiry is ordered by expiry and the days are right');
select t.ok((select count(*) = 2 from public.list_expiry('aaaaaaaa-0000-0000-0000-000000000001', 'expired')), 'bucket expired');
select t.ok((select count(*) = 3 from public.list_expiry('aaaaaaaa-0000-0000-0000-000000000001', 'd30')), 'bucket d30');
select t.ok((select count(*) = 2 from public.list_expiry('aaaaaaaa-0000-0000-0000-000000000001', 'd60')), 'bucket d60');
select t.ok((select count(*) = 2 from public.list_expiry('aaaaaaaa-0000-0000-0000-000000000001', 'd90')), 'bucket d90');
select t.ok((select bool_and(value_at_cost is null) from public.list_expiry('aaaaaaaa-0000-0000-0000-000000000001', 'all')), 'the cashier gets no value from the expiry list');
select t.throws('select * from public.list_expiry(''aaaaaaaa-0000-0000-0000-000000000001'', ''soon'')', '22023', 'an unknown bucket is rejected');
select t.owner();
select t.login('a2000000-0000-0000-0000-000000000001');
select t.ok((select value_at_cost = 20.0000 from public.list_expiry('aaaaaaaa-0000-0000-0000-000000000001', 'd30') where batch_number = 'Z1'), 'the manager sees the cost value of an expiring batch');
select t.owner();

-- ---- movements ------------------------------------------------------------------------------------
select t.login('a4000000-0000-0000-0000-000000000001');
select t.ok((select array_agg(id order by id desc) = array_agg(id) from public.list_stock_movements('aaaaaaaa-0000-0000-0000-000000000001')),
  'movements come newest first');
select t.ok((select count(*) = 5 from public.list_stock_movements('aaaaaaaa-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001')),
  'filter by medicine returns that medicine''s movements only');
select t.ok((select count(*) = 4 from public.list_stock_movements('aaaaaaaa-0000-0000-0000-000000000001', null, (select v from ids where k = 'n1'))),
  'filter by batch returns that batch''s movements only');
select t.ok((select count(*) = 3 from public.list_stock_movements('aaaaaaaa-0000-0000-0000-000000000001', null, null, 'EXPIRED')),
  'filter by type: one manual EXPIRED and two write-offs');
select t.ok((select bool_and(user_name = 'Pharmacist A') from public.list_stock_movements('aaaaaaaa-0000-0000-0000-000000000001', null, null, 'OPENING_STOCK')),
  'the user name comes with each movement');
select t.ok((select count(*) = 2 from public.list_stock_movements('aaaaaaaa-0000-0000-0000-000000000001', null, null, null, null, 2)), 'limit applies');
select t.ok(
  (select min(id) from public.list_stock_movements('aaaaaaaa-0000-0000-0000-000000000001', null, null, null, null, 2))
  > (select max(id) from public.list_stock_movements('aaaaaaaa-0000-0000-0000-000000000001', null, null, null,
       (select min(id) from public.list_stock_movements('aaaaaaaa-0000-0000-0000-000000000001', null, null, null, null, 2)), 2)),
  'keyset paging: the next page continues strictly below the cursor');
select t.ok((select count(*) <= 101 from public.list_stock_movements('aaaaaaaa-0000-0000-0000-000000000001', null, null, null, null, 100000)), 'limit is capped');
select t.throws('select * from public.list_stock_movements(''aaaaaaaa-0000-0000-0000-000000000001'', null, null, ''MAGIC'')', '22023', 'an unknown movement type is rejected');
select t.owner();
select t.login('b1000000-0000-0000-0000-000000000001');
select t.throws('select * from public.list_stock_movements(''aaaaaaaa-0000-0000-0000-000000000001'')', '42501', 'admin B cannot read Branch A movements');
select t.owner();

-- ---- reconciliation --------------------------------------------------------------------------------
select t.login('a1000000-0000-0000-0000-000000000001');
select t.ok((select count(*) = 0 from public.stock_reconciliation('aaaaaaaa-0000-0000-0000-000000000001')),
  'after every flow above, no batch disagrees with its movements (drift = 0)');
select t.owner();
select t.login('a4000000-0000-0000-0000-000000000001');
select t.throws('select * from public.stock_reconciliation(''aaaaaaaa-0000-0000-0000-000000000001'')', '42501', 'only audit.view may run the reconciliation');
select t.owner();

-- Simulate something bypassing the invariant: the check must show it.
set constraints all immediate;
alter table public.medicine_batches disable trigger medicine_batches_stock_invariant;
update public.medicine_batches set quantity = quantity + 3 where id = (select v from ids where k = 'n2');
alter table public.medicine_batches enable trigger medicine_batches_stock_invariant;
select t.login('a1000000-0000-0000-0000-000000000001');
select t.ok((select count(*) = 1 and max(drift) = 3 and max(batch_number) = 'N2' from public.stock_reconciliation('aaaaaaaa-0000-0000-0000-000000000001')),
  'a batch changed without a movement is reported with its drift');
select t.owner();

rollback;
