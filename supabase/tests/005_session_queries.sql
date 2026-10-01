-- The exact queries server/session.ts runs, executed as the signed-in user.
begin;

select t.login('a4000000-0000-0000-0000-000000000001'); -- cashier, Branch A

select t.ok(
  (select count(*) = 1 from public.profiles where id = auth.uid() and full_name = 'Cashier A' and is_active),
  'session: own profile is readable');

select t.ok(
  (select count(*) = 1 from public.branch_members where user_id = auth.uid() and is_active and role = 'CASHIER'),
  'session: own active membership is readable with its role');

select t.ok(
  (select count(*) = 1 from public.branches
    where id in (select branch_id from public.branch_members where user_id = auth.uid() and is_active)
      and is_active),
  'session: the member branch is readable');

select t.ok(
  (select array_agg(p order by p) from public.my_permissions('aaaaaaaa-0000-0000-0000-000000000001') p)
  @> array['sale.create', 'customer.payment', 'stock.view']
  and not ((select array_agg(p) from public.my_permissions('aaaaaaaa-0000-0000-0000-000000000001') p) && array['finance.view_profit', 'purchase.view_cost', 'staff.manage']),
  'session: my_permissions returns counter permissions and no cost/profit/staff rights');

-- Asking for another branch yields nothing, not an error.
select t.ok(t.count('select 1 from public.my_permissions(''bbbbbbbb-0000-0000-0000-000000000001'')') = 0,
  'session: my_permissions for a foreign branch is empty');

select t.owner();

-- A deactivated branch disappears for its members.
update public.branches set is_active = false where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select t.login('a1000000-0000-0000-0000-000000000001');
select t.ok(t.count('select 1 from public.branches') = 0, 'session: an inactive branch is invisible to its admin');
select t.ok(t.count('select 1 from public.my_permissions(''aaaaaaaa-0000-0000-0000-000000000001'')') = 0, 'session: an inactive branch grants no permissions');
select t.owner();

rollback;
