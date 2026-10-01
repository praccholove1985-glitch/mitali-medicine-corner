begin;

-- Signing up creates a profile and grants nothing.
insert into auth.users (id, email, raw_user_meta_data)
values ('d0000000-0000-0000-0000-000000000001', 'new.signup@test', '{"full_name":"New Signup"}');
select t.ok((select full_name from public.profiles where id = 'd0000000-0000-0000-0000-000000000001') = 'New Signup',
  'a new auth user gets a profile from the trigger');
select t.ok((select count(*) = 0 from public.branch_members where user_id = 'd0000000-0000-0000-0000-000000000001'),
  'a new sign-up has no branch membership');

select t.login('d0000000-0000-0000-0000-000000000001');
select t.ok(t.count('select 1 from public.branches') = 0, 'a new sign-up sees no branch');
select t.ok(t.count('select 1 from public.my_branches()') = 0, 'a new sign-up has no branches');
select t.ok(not public.has_permission('aaaaaaaa-0000-0000-0000-000000000001', 'sale.create'), 'a new sign-up has no permission');
select t.owner();

-- An over-long or hostile name cannot break the trigger.
insert into auth.users (id, email, raw_user_meta_data)
values ('d0000000-0000-0000-0000-000000000002', 'long.name@test', json_build_object('full_name', repeat('x', 500))::jsonb);
select t.ok((select length(full_name) = 120 from public.profiles where id = 'd0000000-0000-0000-0000-000000000002'),
  'profile name is truncated to 120 characters');

-- Bootstrap: owner/service role can create the first admin.
create temp table result_branch (id uuid) on commit drop;
insert into result_branch select public.bootstrap_pharmacy('Mitali Medicine Corner', 'NEW.signup@test');
select t.ok((select role = 'ADMIN' and is_active from public.branch_members
              where user_id = 'd0000000-0000-0000-0000-000000000001'
                and branch_id = (select id from result_branch)),
  'bootstrap makes the named user an active ADMIN (email match is case-insensitive)');

select t.login('d0000000-0000-0000-0000-000000000001');
select t.ok(public.has_permission((select id from public.branches where name = 'Mitali Medicine Corner'), 'staff.manage'),
  'the bootstrapped admin has full permissions');
select t.owner();

-- Idempotent: running it again reuses the branch.
select public.bootstrap_pharmacy('Mitali Medicine Corner', 'new.signup@test');
select t.ok((select count(*) = 1 from public.branches where name = 'Mitali Medicine Corner'),
  'bootstrap is idempotent and does not create a second branch');

select t.throws('select public.bootstrap_pharmacy(''X'', ''missing@test'')', 'P0002', 'bootstrap rejects an unknown email');

-- Branch validation.
select t.throws('insert into public.branches (name, timezone) values (''Bad'', ''Mars/Olympus'')', '22023', 'unknown timezone is rejected');
select t.throws('insert into public.branches (name) values (''   '')', '23514', 'blank branch name is rejected');
select t.throws('insert into public.branch_members (user_id, branch_id, role) values (''c0000000-0000-0000-0000-000000000001'', ''aaaaaaaa-0000-0000-0000-000000000001'', ''OWNER'')', '23514', 'unknown role is rejected');

rollback;
