-- Test helpers and shared fixtures. Committed once; later tests run inside
-- transactions that roll back, so they never change these rows.

create schema t;
grant usage on schema t to anon, authenticated;

create function t.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create function t.anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
end $$;

create function t.owner() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

create function t.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is not true then
    raise exception 'FAIL: %', p_msg;
  end if;
  raise notice 'ok - %', p_msg;
end $$;

create function t.count(p_sql text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute 'select count(*) from (' || p_sql || ') q' into n;
  return n;
end $$;

-- Passes only if the statement raises the given SQLSTATE.
create function t.throws(p_sql text, p_sqlstate text, p_msg text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate = p_sqlstate then
      raise notice 'ok - % (%)', p_msg, sqlstate;
      return;
    end if;
    raise exception 'FAIL: % (expected %, got % %)', p_msg, p_sqlstate, sqlstate, sqlerrm;
  end;
  raise exception 'FAIL: % (statement succeeded)', p_msg;
end $$;

grant execute on all functions in schema t to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Fixtures
--   Branch A: admin, manager, pharmacist, cashier, staff, plus two who must
--             have NO access (inactive membership, inactive profile).
--   Branch B: its own admin only.
--   `nobody` has an account but no membership.
-- ---------------------------------------------------------------------------
insert into public.branches (id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Branch A'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Branch B');

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1000000-0000-0000-0000-000000000001', 'admin.a@test', '{"full_name":"Admin A"}'),
  ('a2000000-0000-0000-0000-000000000001', 'manager.a@test', '{"full_name":"Manager A"}'),
  ('a3000000-0000-0000-0000-000000000001', 'pharmacist.a@test', '{"full_name":"Pharmacist A"}'),
  ('a4000000-0000-0000-0000-000000000001', 'cashier.a@test', '{"full_name":"Cashier A"}'),
  ('a5000000-0000-0000-0000-000000000001', 'staff.a@test', '{"full_name":"Staff A"}'),
  ('a6000000-0000-0000-0000-000000000001', 'inactive.member@test', '{"full_name":"Inactive Member"}'),
  ('a7000000-0000-0000-0000-000000000001', 'inactive.profile@test', '{"full_name":"Inactive Profile"}'),
  ('b1000000-0000-0000-0000-000000000001', 'admin.b@test', '{"full_name":"Admin B"}'),
  ('c0000000-0000-0000-0000-000000000001', 'nobody@test', '{"full_name":"Nobody"}');

insert into public.branch_members (user_id, branch_id, role, is_active) values
  ('a1000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'ADMIN', true),
  ('a2000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'MANAGER', true),
  ('a3000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'PHARMACIST', true),
  ('a4000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'CASHIER', true),
  ('a5000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'STAFF', true),
  ('a6000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'ADMIN', false),
  ('a7000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'ADMIN', true),
  ('b1000000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'ADMIN', true);

update public.profiles set is_active = false where id = 'a7000000-0000-0000-0000-000000000001';

-- Per-user overrides in branch A: staff may sell; manager may not edit prices.
insert into public.user_permission_overrides (user_id, branch_id, permission, granted) values
  ('a5000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'sale.create', true),
  ('a2000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'price.edit', false);
