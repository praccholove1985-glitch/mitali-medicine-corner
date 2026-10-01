begin;

-- Append-only holds even for the table owner.
select t.throws('update public.audit_log set action = ''tampered'' where id = (select min(id) from public.audit_log)', 'PH010', 'owner cannot update audit rows');
select t.throws('delete from public.audit_log where id = (select min(id) from public.audit_log)', 'PH010', 'owner cannot delete audit rows');
select t.throws('truncate public.audit_log', 'PH010', 'owner cannot truncate the audit log');

-- Role-bundle edits are audited, with old and new values, organisation-wide.
delete from public.audit_log where false; -- no-op, proves DML on the table is only blocked per row
insert into public.role_permissions (role, permission) values ('CASHIER', 'sale.return');
select t.ok(
  (select count(*) = 1 from public.audit_log
    where action = 'role_permissions.insert'
      and entity_id = 'CASHIER:sale.return'
      and branch_id is null
      and new_values ->> 'permission' = 'sale.return'
      and old_values is null),
  'inserting a role permission is audited');
delete from public.role_permissions where role = 'CASHIER' and permission = 'sale.return';
select t.ok(
  (select count(*) = 1 from public.audit_log
    where action = 'role_permissions.delete' and entity_id = 'CASHIER:sale.return'
      and old_values ->> 'role' = 'CASHIER' and new_values is null),
  'removing a role permission is audited with the old values');

-- Membership and override changes are audited per branch.
update public.branch_members set role = 'MANAGER'
 where user_id = 'a4000000-0000-0000-0000-000000000001' and branch_id = 'aaaaaaaa-0000-0000-0000-000000000001';
select t.ok(
  (select count(*) = 1 from public.audit_log
    where action = 'branch_members.update'
      and branch_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and old_values ->> 'role' = 'CASHIER' and new_values ->> 'role' = 'MANAGER'),
  'changing a member role is audited with old and new role');

insert into public.user_permission_overrides (user_id, branch_id, permission, granted)
values ('a4000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'sale.discount', true);
select t.ok(
  (select count(*) = 1 from public.audit_log
    where action = 'user_permission_overrides.insert'
      and entity_id like 'a4000000-0000-0000-0000-000000000001:aaaaaaaa-0000-0000-0000-000000000001:sale.discount'),
  'a permission override is audited');

-- Settings changes are audited.
update public.branches set settings = '{"vat_inclusive": true}' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select t.ok(
  (select count(*) = 1 from public.audit_log
    where action = 'branches.update' and new_values -> 'settings' ->> 'vat_inclusive' = 'true'),
  'a settings change is audited');

-- Deactivating a user is audited; a rename is not noise.
update public.profiles set is_active = false where id = 'a5000000-0000-0000-0000-000000000001';
select t.ok(
  (select count(*) = 1 from public.audit_log
    where action = 'profiles.update' and entity_id = 'a5000000-0000-0000-0000-000000000001'
      and old_values ->> 'is_active' = 'true' and new_values ->> 'is_active' = 'false'),
  'deactivating a profile is audited');
update public.profiles set full_name = 'Only a rename' where id = 'a5000000-0000-0000-0000-000000000001';
select t.ok(
  (select count(*) = 1 from public.audit_log where action = 'profiles.update' and entity_id = 'a5000000-0000-0000-0000-000000000001'),
  'renaming a profile does not write an audit row');

-- The actor is recorded from the session, not from anything the caller supplies.
select set_config('request.jwt.claims', json_build_object('sub', 'a1000000-0000-0000-0000-000000000001', 'role', 'service_role')::text, true);
update public.branches set phone = '01700000000' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select t.ok(
  (select actor_id = 'a1000000-0000-0000-0000-000000000001' from public.audit_log
    where action = 'branches.update' and new_values ->> 'phone' = '01700000000'),
  'audit rows record auth.uid() as the actor');
select t.owner();

-- Visibility: audit.view is required, and only for that branch.
select t.login('a4000000-0000-0000-0000-000000000001'); -- cashier now MANAGER inside this txn; restore below
select t.owner();
update public.branch_members set role = 'CASHIER'
 where user_id = 'a4000000-0000-0000-0000-000000000001' and branch_id = 'aaaaaaaa-0000-0000-0000-000000000001';

select t.login('a4000000-0000-0000-0000-000000000001');
select t.ok(t.count('select 1 from public.audit_log') = 0, 'cashier cannot read the audit log');
select t.owner();

select t.login('a1000000-0000-0000-0000-000000000001');
select t.ok(t.count('select 1 from public.audit_log where branch_id = ''aaaaaaaa-0000-0000-0000-000000000001''') > 0, 'admin A reads Branch A audit rows');
select t.ok(t.count('select 1 from public.audit_log where branch_id = ''bbbbbbbb-0000-0000-0000-000000000001''') = 0, 'admin A cannot read Branch B audit rows');
select t.ok(t.count('select 1 from public.audit_log where branch_id is null') > 0, 'admin A reads organisation-wide audit rows');
select t.owner();

select t.login('a3000000-0000-0000-0000-000000000001');
select t.ok(t.count('select 1 from public.audit_log where branch_id is null') = 0, 'pharmacist cannot read organisation-wide audit rows');
select t.owner();

rollback;
