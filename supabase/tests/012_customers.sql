-- Customers and the ledger: receiving payments, statements, the due list.
-- Money is compared as exact decimals (text) so a rounding slip cannot hide.
begin;

insert into public.customers (id, branch_id, name, phone, credit_limit, is_active) values
  ('d1000000-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-000000000001', 'Due One',      '01811111111', 1000, true),
  ('d2000000-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-000000000001', 'Clear',        '01822222222', null, true),
  ('d3000000-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-000000000001', 'Inactive Due', '01833333333', null, false),
  ('d4000000-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-000000000001', 'Over Limit',   '01844444444', 100,  true),
  ('d5000000-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-000000000001', 'Advance',      '01855555555', null, true),
  ('e1000000-0000-0000-0000-0000000000c1', 'bbbbbbbb-0000-0000-0000-000000000001', 'Branch B due', '01866666666', null, true);

insert into public.customer_ledger_entries (branch_id, customer_id, entry_type, amount, created_at) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-0000000000c1', 'SALE_DUE',  300, '2026-08-10 12:00:00+06'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-0000000000c1', 'SALE_DUE',  200, '2026-09-05 12:00:00+06'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-0000000000c1', 'PAYMENT',  -100, '2026-09-20 12:00:00+06'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-0000000000c1', 'SALE_DUE',   40, '2026-08-31 23:59:59+06'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-0000000000c1', 'SALE_DUE',   60, '2026-09-01 00:00:00+06'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-0000000000c1', 'SALE_DUE',  150, '2026-09-02 12:00:00+06'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'd5000000-0000-0000-0000-0000000000c1', 'SALE_DUE',   50, '2026-09-02 12:00:00+06'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'd5000000-0000-0000-0000-0000000000c1', 'PAYMENT',   -80, '2026-09-03 12:00:00+06'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-0000000000c1', 'SALE_DUE',   70, '2026-09-02 12:00:00+06');

create temp table ids (k text primary key, v jsonb) on commit drop;
grant all on ids to authenticated;

create function pg_temp.pay(p_customer text, p_amount text, p_method text default 'CASH', p_request uuid default gen_random_uuid(), p_branch text default 'aaaaaaaa-0000-0000-0000-000000000001', p_reference text default null) returns jsonb
language sql as $f$
  select public.receive_customer_payment(jsonb_strip_nulls(jsonb_build_object(
    'branch_id', p_branch::uuid, 'customer_id', p_customer::uuid, 'client_request_id', p_request,
    'method', p_method, 'amount', p_amount, 'reference', p_reference)))
$f$;
grant execute on function pg_temp.pay(text, text, text, uuid, text, text) to authenticated;

-- ---- permissions ---------------------------------------------------------------------------
select t.anon();
select t.throws('select public.list_customers(''aaaaaaaa-0000-0000-0000-000000000001'')', '42501', 'anon cannot list customers');
select t.throws('select public.receive_customer_payment(''{}''::jsonb)', '42501', 'anon cannot receive a payment');
select t.owner();

select t.login('a5000000-0000-0000-0000-000000000001'); -- staff: no customer permissions
select t.throws('select public.list_customers(''aaaaaaaa-0000-0000-0000-000000000001'')', '42501', 'staff cannot list customers');
select t.throws('select public.due_summary(''aaaaaaaa-0000-0000-0000-000000000001'')', '42501', 'staff cannot see the due summary');
select t.throws('select public.customer_statement(''aaaaaaaa-0000-0000-0000-000000000001'', ''d1000000-0000-0000-0000-0000000000c1'', ''2026-09-01'', ''2026-09-30'')', '42501', 'staff cannot read a statement');
select t.throws(format('select pg_temp.pay(%L, ''10'')', 'd1000000-0000-0000-0000-0000000000c1'), '42501', 'staff cannot receive a payment');
select t.owner();

select t.login('b1000000-0000-0000-0000-000000000001'); -- admin of Branch B
select t.throws('select public.list_customers(''aaaaaaaa-0000-0000-0000-000000000001'')', '42501', 'admin B cannot list Branch A customers');
select t.throws(format('select pg_temp.pay(%L, ''10'')', 'd1000000-0000-0000-0000-0000000000c1'), '42501', 'admin B cannot take a payment in Branch A');
select t.throws(format('select pg_temp.pay(%L, ''10'', ''CASH'', gen_random_uuid(), ''bbbbbbbb-0000-0000-0000-000000000001'')', 'd1000000-0000-0000-0000-0000000000c1'),
  'P0002', 'a Branch A customer is not found from Branch B, even with Branch B permission');
select t.ok((select count(*) = 1 and max(name) = 'Branch B due' from public.list_customers('bbbbbbbb-0000-0000-0000-000000000001')), 'admin B sees their own customers');
select t.owner();

-- ---- list and summary figures -----------------------------------------------------------------
select t.login('a4000000-0000-0000-0000-000000000001'); -- cashier
select t.ok((select total_due = 650.00 and customers_with_due = 3 and customers_over_limit = 1 and active_customers = 4 and advance_total = 30.00
               from public.due_summary('aaaaaaaa-0000-0000-0000-000000000001')),
  'due summary: 650 owed by 3 customers, 1 over limit, 30 held in advance');
select t.ok((select count(*) = 5 and max(total_count) = 5 from public.list_customers('aaaaaaaa-0000-0000-0000-000000000001')), 'all five Branch A customers are listed');
select t.ok((select array_agg(name order by balance desc) = array['Due One','Over Limit'] from public.list_customers('aaaaaaaa-0000-0000-0000-000000000001', '', 'due')),
  'the due list is active customers who owe, largest first (inactive excluded)');
select t.ok((select array_agg(name) = array['Over Limit'] from public.list_customers('aaaaaaaa-0000-0000-0000-000000000001', '', 'over_limit')), 'over-limit filter');
select t.ok((select array_agg(name order by name) = array['Over Limit'] from public.list_customers('aaaaaaaa-0000-0000-0000-000000000001') where over_limit), 'only Over Limit carries the over_limit flag (a customer with no limit never does)');
select t.ok((select array_agg(name) = array['Inactive Due'] from public.list_customers('aaaaaaaa-0000-0000-0000-000000000001', '', 'inactive')), 'inactive filter');
select t.ok((select count(*) = 1 and max(name) = 'Clear' and max(balance) = 0 from public.list_customers('aaaaaaaa-0000-0000-0000-000000000001', 'clea')), 'search by name');
select t.ok((select count(*) = 1 and max(name) = 'Over Limit' from public.list_customers('aaaaaaaa-0000-0000-0000-000000000001', '0184')), 'search by phone');
select t.ok((select count(*) = 0 from public.list_customers('aaaaaaaa-0000-0000-0000-000000000001', '%')), 'a percent sign is searched literally');
select t.ok((select count(*) = 2 and max(total_count) = 5 from public.list_customers('aaaaaaaa-0000-0000-0000-000000000001', '', 'all', 2, 0)), 'paging returns the page and the full count');
select t.throws('select public.list_customers(''aaaaaaaa-0000-0000-0000-000000000001'', '''', ''bogus'')', '22023', 'an unknown filter is rejected');
select t.ok((public.customer_summary('aaaaaaaa-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-0000000000c1') ->> 'balance') = '400.00'
        and (public.customer_summary('aaaaaaaa-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-0000000000c1') ->> 'available_credit') = '600.00',
  'summary: balance 400 and 600 of the 1000 limit still available');
select t.ok((public.customer_summary('aaaaaaaa-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-0000000000c1') ->> 'available_credit') = '0.00', 'available credit never goes below 0');
select t.ok((public.customer_summary('aaaaaaaa-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-0000000000c1') -> 'available_credit') = 'null'::jsonb, 'no limit means no available-credit figure');
select t.ok(public.customer_summary('aaaaaaaa-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-0000000000c1') is null, 'a Branch B customer reads as not found from Branch A');
select t.ok((public.customer_summary('aaaaaaaa-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-0000000000c1') ->> 'can_receive_payment') = 'true', 'the summary tells the UI whether payments are allowed');
select t.owner();

-- ---- statements -------------------------------------------------------------------------------
select t.login('a4000000-0000-0000-0000-000000000001');
select t.ok((select s ->> 'opening' = '300.00' and s ->> 'closing' = '400.00' and s ->> 'total_charges' = '200.00'
                and s ->> 'total_credits' = '100.00' and (s ->> 'entry_count')::int = 2
                and (s -> 'entries' -> 0 ->> 'running') = '500.00' and (s -> 'entries' -> 1 ->> 'running') = '400.00'
               from (select public.customer_statement('aaaaaaaa-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-0000000000c1', '2026-09-01', '2026-09-30') s) q),
  'September statement: opening 300, +200, -100, closing 400, running balances 500 then 400');
select t.ok((select s ->> 'opening' = '0.00' and s ->> 'closing' = '300.00'
               from (select public.customer_statement('aaaaaaaa-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-0000000000c1', '2026-08-01', '2026-08-31') s) q),
  'August statement opens at 0 and closes at 300');
select t.ok((select s ->> 'opening' = '40.00' and s ->> 'closing' = '100.00' and (s ->> 'entry_count')::int = 1
               from (select public.customer_statement('aaaaaaaa-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-0000000000c1', '2026-09-01', '2026-09-30') s) q),
  'an entry at 23:59:59 on 31 Aug belongs to August and one at 00:00:00 on 1 Sep to September (branch timezone)');
select t.ok((select s ->> 'opening' = '400.00' and s ->> 'closing' = '400.00' and jsonb_array_length(s -> 'entries') = 0
               from (select public.customer_statement('aaaaaaaa-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-0000000000c1', '2026-10-01', '2026-10-31') s) q),
  'a quiet month carries the balance through with no entries');
select t.throws('select public.customer_statement(''aaaaaaaa-0000-0000-0000-000000000001'', ''d1000000-0000-0000-0000-0000000000c1'', ''2026-09-30'', ''2026-09-01'')', '22023', 'a backwards range is rejected');
select t.throws('select public.customer_statement(''aaaaaaaa-0000-0000-0000-000000000001'', ''d1000000-0000-0000-0000-0000000000c1'', ''2000-01-01'', ''2026-09-01'')', '22023', 'an enormous range is rejected');
select t.throws('select public.customer_statement(''aaaaaaaa-0000-0000-0000-000000000001'', ''e1000000-0000-0000-0000-0000000000c1'', ''2026-09-01'', ''2026-09-30'')', 'P0002', 'a statement for another branch''s customer is not found');
select t.owner();

-- ---- receiving payments ----------------------------------------------------------------------
select t.login('a4000000-0000-0000-0000-000000000001');
insert into ids values ('req1', to_jsonb(gen_random_uuid()));
insert into ids values ('pay1', pg_temp.pay('d1000000-0000-0000-0000-0000000000c1', '150.00', 'BKASH', (select (v #>> '{}')::uuid from ids where k = 'req1'), 'aaaaaaaa-0000-0000-0000-000000000001', 'TX123'));
select t.ok((select v ->> 'balance_after' = '250.00' and (v ->> 'replayed') = 'false' from ids where k = 'pay1'), 'a 150 payment takes 400 down to 250');
select t.ok((select count(*) = 1 and max(method) = 'BKASH' and max(reference) = 'TX123' and max(amount) = 150.00 and max(direction) = 'IN' and bool_and(sale_id is null)
               from public.payments where customer_id = 'd1000000-0000-0000-0000-0000000000c1'),
  'the payment row records method, reference, amount and direction');
select t.ok((select count(*) = 1 and max(amount) = -150.00 and max(entry_type) = 'PAYMENT' and bool_and(payment_id is not null)
               from public.customer_ledger_entries where customer_id = 'd1000000-0000-0000-0000-0000000000c1' and created_at = now()),
  'one PAYMENT ledger entry is linked to it');
select t.ok(public.customer_balance('aaaaaaaa-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-0000000000c1') = 250.00, 'the ledger balance is now 250');

insert into ids values ('pay1b', pg_temp.pay('d1000000-0000-0000-0000-0000000000c1', '150.00', 'BKASH', (select (v #>> '{}')::uuid from ids where k = 'req1'), 'aaaaaaaa-0000-0000-0000-000000000001', 'TX123'));
select t.ok((select (b.v ->> 'payment_id') = (a.v ->> 'payment_id') and (b.v ->> 'replayed') = 'true' and b.v ->> 'balance_after' = '250.00'
               from ids a, ids b where a.k = 'pay1' and b.k = 'pay1b'), 'a retry with the same request id returns the original payment');
select t.ok((select count(*) = 1 from public.payments where customer_id = 'd1000000-0000-0000-0000-0000000000c1'), 'a retry does not record a second payment');
select t.ok(public.customer_balance('aaaaaaaa-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-0000000000c1') = 250.00, 'a retry does not change the balance');

select t.throws(format('select pg_temp.pay(%L, ''250.01'')', 'd1000000-0000-0000-0000-0000000000c1'), 'PH058', 'paying 1 paisa more than is due is refused');
select t.throws(format('select pg_temp.pay(%L, ''10'')', 'd2000000-0000-0000-0000-0000000000c1'), 'PH058', 'a customer who owes nothing cannot pay');
select t.throws(format('select pg_temp.pay(%L, ''10'')', 'd5000000-0000-0000-0000-0000000000c1'), 'PH058', 'a customer with an advance owes nothing and cannot pay');
select t.throws(format('select pg_temp.pay(%L, ''0'')', 'd1000000-0000-0000-0000-0000000000c1'), '22023', 'zero is refused');
select t.throws(format('select pg_temp.pay(%L, ''-5'')', 'd1000000-0000-0000-0000-0000000000c1'), '22023', 'a negative amount is refused');
select t.throws(format('select pg_temp.pay(%L, ''1.005'')', 'd1000000-0000-0000-0000-0000000000c1'), '22023', 'a third decimal is refused');
select t.throws(format('select pg_temp.pay(%L, ''abc'')', 'd1000000-0000-0000-0000-0000000000c1'), '22023', 'a non-number is refused');
select t.throws(format('select pg_temp.pay(%L, ''10'', ''CREDIT'')', 'd1000000-0000-0000-0000-0000000000c1'), '22023', 'credit is not a way to pay a due');
select t.throws(format('select pg_temp.pay(%L, ''10'', ''GOLD'')', 'd1000000-0000-0000-0000-0000000000c1'), '22023', 'an unknown method is refused');
select t.throws(format('select public.receive_customer_payment(jsonb_build_object(''branch_id'', ''aaaaaaaa-0000-0000-0000-000000000001'', ''customer_id'', %L, ''client_request_id'', gen_random_uuid(), ''method'', ''CASH'', ''amount'', ''5'', ''balance'', 0))', 'd1000000-0000-0000-0000-0000000000c1'),
  '22023', 'unknown fields are rejected');
select t.ok(public.customer_balance('aaaaaaaa-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-0000000000c1') = 250.00, 'refused payments changed nothing');

select t.ok((select s -> 'entries' -> 2 ->> 'method' = 'BKASH' and s -> 'entries' -> 2 ->> 'reference' = 'TX123' and s -> 'entries' -> 2 ->> 'amount' = '-150.00'
                and s ->> 'closing' = '250.00' and s -> 'entries' -> 2 ->> 'by' = 'Cashier A'
               from (select public.customer_statement('aaaaaaaa-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-0000000000c1', '2026-09-01', '2026-12-31') s) q),
  'the statement shows the payment method, reference, who took it, and the new closing balance');

insert into ids values ('pay2', pg_temp.pay('d1000000-0000-0000-0000-0000000000c1', '250.00', 'CASH'));
select t.ok((select v ->> 'balance_after' = '0.00' from ids where k = 'pay2'), 'paying exactly what is due clears it');
select t.throws(format('select pg_temp.pay(%L, ''0.01'')', 'd1000000-0000-0000-0000-0000000000c1'), 'PH058', 'nothing more can be paid once cleared');
insert into ids values ('pay3', pg_temp.pay('d3000000-0000-0000-0000-0000000000c1', '10.00', 'CASH'));
select t.ok((select v ->> 'balance_after' = '90.00' from ids where k = 'pay3'), 'an inactive customer can still pay off what they owe');
select t.owner();

-- ---- the ledger cannot be edited -----------------------------------------------------------------
select t.throws('update public.customer_ledger_entries set amount = -1 where payment_id is not null', 'PH010', 'a payment entry cannot be edited');
select t.throws('delete from public.customer_ledger_entries where payment_id is not null', 'PH010', 'a payment entry cannot be deleted');
select t.login('a4000000-0000-0000-0000-000000000001');
select t.throws('delete from public.payments', '42501', 'a cashier cannot delete payments directly');
select t.throws('insert into public.customer_ledger_entries (branch_id, customer_id, entry_type, amount) values (''aaaaaaaa-0000-0000-0000-000000000001'', ''d1000000-0000-0000-0000-0000000000c1'', ''PAYMENT'', -5)', '42501', 'a cashier cannot write ledger entries directly');
select t.owner();

-- ---- audit and invariants ------------------------------------------------------------------------
select t.ok((select count(*) = 3 and bool_and(actor_id = 'a4000000-0000-0000-0000-000000000001') from public.audit_log where action = 'customer.payment'),
  'each payment is audited once with its actor (the retry added none)');
select t.ok((select new_values ->> 'balance_before' = '400.00' and new_values ->> 'balance_after' = '250.00' and new_values ->> 'method' = 'BKASH'
               from public.audit_log where action = 'customer.payment' and (new_values ->> 'payment_id') = (select v ->> 'payment_id' from ids where k = 'pay1')),
  'the audit entry records the balance before and after');
select t.login('a1000000-0000-0000-0000-000000000001');
select t.ok((select total_due = 240.00 and customers_with_due = 2 and advance_total = 30.00
               from public.due_summary('aaaaaaaa-0000-0000-0000-000000000001')),
  'after the three payments: Inactive Due 90 + Over Limit 150 = 240 still owed');
select t.owner();

rollback;
