-- Permissions, visibility and write denial per role and per branch.
begin;

-- ---- anon sees and does nothing -------------------------------------------
select t.anon();
select t.throws('select * from public.branches', '42501', 'anon cannot read branches');
select t.throws('select * from public.profiles', '42501', 'anon cannot read profiles');
select t.throws('select public.has_permission(''aaaaaaaa-0000-0000-0000-000000000001'', ''sale.create'')', '42501', 'anon cannot call has_permission');
select t.owner();

-- ---- a user with no membership sees nothing --------------------------------
select t.login('c0000000-0000-0000-0000-000000000001');
select t.ok(t.count('select 1 from public.branches') = 0, 'no membership: no branches visible');
select t.ok(t.count('select 1 from public.branch_members') = 0, 'no membership: no members visible');
select t.ok(t.count('select 1 from public.audit_log') = 0, 'no membership: no audit rows visible');
select t.ok(t.count('select 1 from public.my_branches()') = 0, 'no membership: my_branches is empty');
select t.ok(t.count('select 1 from public.profiles') = 1, 'no membership: only own profile visible');
select t.ok(not public.has_permission('aaaaaaaa-0000-0000-0000-000000000001', 'sale.create'), 'no membership: no permission');
select t.owner();

-- ---- branch isolation ------------------------------------------------------
select t.login('a1000000-0000-0000-0000-000000000001'); -- admin A
select t.ok(t.count('select 1 from public.branches') = 1, 'admin A sees exactly one branch');
select t.ok((select name from public.branches) = 'Branch A', 'admin A sees Branch A');
select t.ok(t.count('select 1 from public.branch_members where branch_id = ''bbbbbbbb-0000-0000-0000-000000000001''') = 0,
  'admin A cannot see Branch B members');
select t.ok(not public.has_permission('bbbbbbbb-0000-0000-0000-000000000001', 'sale.create'),
  'admin A has no permission in Branch B');
select t.ok(t.count('select 1 from public.profiles where id = ''b1000000-0000-0000-0000-000000000001''') = 0,
  'admin A cannot see Branch B admin profile');
select t.ok(t.count('select 1 from public.profiles where id = ''a4000000-0000-0000-0000-000000000001''') = 1,
  'admin A can see a colleague profile in the same branch');
select t.owner();

select t.login('b1000000-0000-0000-0000-000000000001'); -- admin B
select t.ok(t.count('select 1 from public.branch_members where branch_id = ''aaaaaaaa-0000-0000-0000-000000000001''') = 0,
  'admin B cannot see Branch A members');
select t.ok(t.count('select 1 from public.audit_log where branch_id = ''aaaaaaaa-0000-0000-0000-000000000001''') = 0,
  'admin B cannot read Branch A audit log');
select t.owner();

-- ---- role matrix -----------------------------------------------------------
create temp table expectations (uid uuid, perm text, expected boolean) on commit drop;
grant all on expectations to authenticated;
insert into expectations values
  -- admin
  ('a1000000-0000-0000-0000-000000000001', 'staff.manage', true),
  ('a1000000-0000-0000-0000-000000000001', 'settings.edit', true),
  ('a1000000-0000-0000-0000-000000000001', 'finance.view_profit', true),
  ('a1000000-0000-0000-0000-000000000001', 'audit.view', true),
  -- manager (price.edit is revoked by override)
  ('a2000000-0000-0000-0000-000000000001', 'purchase.create', true),
  ('a2000000-0000-0000-0000-000000000001', 'finance.view_profit', true),
  ('a2000000-0000-0000-0000-000000000001', 'staff.manage', false),
  ('a2000000-0000-0000-0000-000000000001', 'settings.edit', false),
  ('a2000000-0000-0000-0000-000000000001', 'price.edit', false),
  -- pharmacist
  ('a3000000-0000-0000-0000-000000000001', 'sale.create', true),
  ('a3000000-0000-0000-0000-000000000001', 'stock.adjust', true),
  ('a3000000-0000-0000-0000-000000000001', 'price.edit', false),
  ('a3000000-0000-0000-0000-000000000001', 'purchase.create', false),
  ('a3000000-0000-0000-0000-000000000001', 'finance.view_profit', false),
  -- cashier
  ('a4000000-0000-0000-0000-000000000001', 'sale.create', true),
  ('a4000000-0000-0000-0000-000000000001', 'customer.payment', true),
  ('a4000000-0000-0000-0000-000000000001', 'sale.return', false),
  ('a4000000-0000-0000-0000-000000000001', 'stock.adjust', false),
  ('a4000000-0000-0000-0000-000000000001', 'finance.view_profit', false),
  ('a4000000-0000-0000-0000-000000000001', 'purchase.view_cost', false),
  ('a4000000-0000-0000-0000-000000000001', 'audit.view', false),
  -- staff (sale.create granted by override; nothing else leaks)
  ('a5000000-0000-0000-0000-000000000001', 'sale.create', true),
  ('a5000000-0000-0000-0000-000000000001', 'stock.view', true),
  ('a5000000-0000-0000-0000-000000000001', 'stock.adjust', false),
  ('a5000000-0000-0000-0000-000000000001', 'customer.payment', false),
  -- no access despite an ADMIN row
  ('a6000000-0000-0000-0000-000000000001', 'sale.create', false),
  ('a7000000-0000-0000-0000-000000000001', 'sale.create', false),
  ('a7000000-0000-0000-0000-000000000001', 'staff.manage', false);

do $$
declare
  e record;
  actual boolean;
begin
  for e in select * from expectations loop
    perform t.login(e.uid);
    actual := public.has_permission('aaaaaaaa-0000-0000-0000-000000000001', e.perm);
    perform t.owner();
    if actual is distinct from e.expected then
      raise exception 'FAIL: % / % expected % got %', e.uid, e.perm, e.expected, actual;
    end if;
  end loop;
  raise notice 'ok - role and override matrix (% checks)', (select count(*) from expectations);
end $$;

-- ---- inactive users --------------------------------------------------------
select t.login('a6000000-0000-0000-0000-000000000001');
select t.ok(t.count('select 1 from public.my_branches()') = 0, 'inactive membership: no branches');
select t.ok(t.count('select 1 from public.branches') = 0, 'inactive membership: branch invisible');
select t.owner();
select t.login('a7000000-0000-0000-0000-000000000001');
select t.ok(t.count('select 1 from public.my_branches()') = 0, 'inactive profile: no branches');
select t.ok(t.count('select 1 from public.my_permissions(''aaaaaaaa-0000-0000-0000-000000000001'')') = 0, 'inactive profile: no permissions');
select t.owner();

-- ---- my_permissions agrees with has_permission ------------------------------
select t.login('a4000000-0000-0000-0000-000000000001');
select t.ok(
  (select array_agg(p order by p) from public.my_permissions('aaaaaaaa-0000-0000-0000-000000000001') p)
  = (select array_agg(c.code order by c.code) from public.permissions c
      where public.has_permission('aaaaaaaa-0000-0000-0000-000000000001', c.code)),
  'my_permissions equals the has_permission set for the cashier');
select t.owner();

-- ---- staff directory visibility ---------------------------------------------
select t.login('a4000000-0000-0000-0000-000000000001'); -- cashier: no staff.view
select t.ok(t.count('select 1 from public.branch_members') = 1, 'cashier sees only their own membership row');
select t.owner();
select t.login('a2000000-0000-0000-0000-000000000001'); -- manager: staff.view
select t.ok(t.count('select 1 from public.branch_members where branch_id = ''aaaaaaaa-0000-0000-0000-000000000001''') = 7,
  'manager (staff.view) sees every Branch A membership');
select t.ok(t.count('select 1 from public.user_permission_overrides') = 2, 'manager sees Branch A overrides');
select t.owner();

-- ---- writes are denied for authenticated ------------------------------------
select t.login('a1000000-0000-0000-0000-000000000001'); -- even the admin
select t.throws('insert into public.branches (name) values (''Evil'')', '42501', 'admin cannot insert a branch directly');
select t.throws('update public.branches set name = ''X''', '42501', 'admin cannot update branches directly');
select t.throws('delete from public.branch_members', '42501', 'admin cannot delete memberships directly');
select t.throws('insert into public.branch_members (user_id, branch_id, role) values (''c0000000-0000-0000-0000-000000000001'', ''aaaaaaaa-0000-0000-0000-000000000001'', ''ADMIN'')', '42501', 'admin cannot grant membership directly');
select t.throws('insert into public.role_permissions (role, permission) values (''CASHIER'', ''staff.manage'')', '42501', 'admin cannot edit role bundles directly');
select t.throws('insert into public.user_permission_overrides (user_id, branch_id, permission, granted) values (''a4000000-0000-0000-0000-000000000001'', ''aaaaaaaa-0000-0000-0000-000000000001'', ''staff.manage'', true)', '42501', 'admin cannot insert overrides directly');
select t.throws('insert into public.audit_log (action, entity_type) values (''forged'', ''x'')', '42501', 'admin cannot forge audit rows');
select t.throws('update public.audit_log set action = ''x''', '42501', 'admin cannot edit audit rows');
select t.throws('select public.write_audit(null, ''a'', ''b'', null, null, null)', '42501', 'authenticated cannot call write_audit');
select t.throws('select public.bootstrap_pharmacy(''X'', ''admin.a@test'')', '42501', 'authenticated cannot call bootstrap_pharmacy');
select t.owner();

-- ---- a user cannot escalate through their own profile ------------------------
select t.login('a4000000-0000-0000-0000-000000000001');
select t.throws('update public.profiles set is_active = true where id = auth.uid()', '42501', 'cannot change own is_active');
update public.profiles set full_name = 'Renamed Cashier' where id = auth.uid();
select t.ok((select full_name from public.profiles where id = auth.uid()) = 'Renamed Cashier', 'can rename own profile');
select t.ok(t.count('select 1 from public.profiles where id = ''a1000000-0000-0000-0000-000000000001'' and full_name = ''Hacked''') = 0, 'setup sanity');
update public.profiles set full_name = 'Hacked' where id = 'a1000000-0000-0000-0000-000000000001';
select t.owner();
select t.ok((select full_name from public.profiles where id = 'a1000000-0000-0000-0000-000000000001') = 'Admin A',
  'cannot rename someone else (update touches zero rows)');

rollback;
