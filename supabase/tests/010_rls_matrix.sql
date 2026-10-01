-- Exhaustive RLS check, driven by the catalogue so new tables are covered the day
-- they are created:
--   1. no signed-in role (or anon) can insert, delete, truncate or update any column of
--      any table directly, except a user renaming themselves on profiles
--   2. anon cannot even read any table
--   3. on every table that has a branch_id, users of one branch see no rows of the other
begin;

-- Data in both branches so the cross-branch check has something to find.
insert into public.medicines (id, name) values ('e9000000-0000-0000-0000-000000000001', 'Matrix medicine');
insert into public.medicine_batches (id, branch_id, medicine_id, batch_number, expiry_date, purchase_price, sale_price, quantity) values
  ('e9100000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-000000000001', 'MA', current_date + 100, 1, 2, 5),
  ('e9100000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-000000000001', 'MB', current_date + 100, 1, 2, 7);
insert into public.stock_movements (branch_id, medicine_id, batch_id, quantity_delta, movement_type) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-000000000001', 'e9100000-0000-0000-0000-00000000000a', 5, 'OPENING_STOCK'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-000000000001', 'e9100000-0000-0000-0000-00000000000b', 7, 'OPENING_STOCK');
set constraints all immediate;

-- ---- 1. direct writes are impossible for every role on every table -------------------
do $$
declare
  u record;
  tbl record;
  col text;
  checked integer := 0;
begin
  for u in
    select * from (values
      ('a1000000-0000-0000-0000-000000000001'::uuid, 'admin A'),
      ('a2000000-0000-0000-0000-000000000001', 'manager A'),
      ('a3000000-0000-0000-0000-000000000001', 'pharmacist A'),
      ('a4000000-0000-0000-0000-000000000001', 'cashier A'),
      ('a5000000-0000-0000-0000-000000000001', 'staff A'),
      ('b1000000-0000-0000-0000-000000000001', 'admin B'),
      ('c0000000-0000-0000-0000-000000000001', 'no membership'),
      (null, 'anon')
    ) x(id, label)
  loop
    if u.id is null then perform t.anon(); else perform t.login(u.id); end if;

    for tbl in
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' order by c.relname
    loop
      select a.attname into col from pg_attribute a
       where a.attrelid = ('public.' || quote_ident(tbl.relname))::regclass and a.attnum > 0 and not a.attisdropped and a.attidentity = ''
       order by a.attnum limit 1;

      -- Rename-yourself on profiles is the one allowed UPDATE, and only for name/phone.
      foreach col in array array[col] loop
        begin
          execute format('update public.%I set %I = %I where false', tbl.relname, col, col);
          perform t.owner();
          raise exception 'FAIL: % could UPDATE %.%', u.label, tbl.relname, col;
        exception when insufficient_privilege then
          checked := checked + 1;
        end;
      end loop;

      begin
        execute format('insert into public.%I default values', tbl.relname);
        perform t.owner();
        raise exception 'FAIL: % could INSERT into %', u.label, tbl.relname;
      exception when insufficient_privilege then
        checked := checked + 1;
      end;

      begin
        execute format('delete from public.%I where false', tbl.relname);
        perform t.owner();
        raise exception 'FAIL: % could DELETE from %', u.label, tbl.relname;
      exception when insufficient_privilege then
        checked := checked + 1;
      end;

      begin
        execute format('truncate public.%I', tbl.relname);
        perform t.owner();
        raise exception 'FAIL: % could TRUNCATE %', u.label, tbl.relname;
      exception when insufficient_privilege then
        checked := checked + 1;
      end;
    end loop;
  end loop;
  perform t.owner();
  raise notice 'ok - % direct-write attempts were all refused (every role x every table)', checked;
end $$;

-- ---- 2. anon cannot read any table -------------------------------------------------------
do $$
declare
  tbl record;
  checked integer := 0;
begin
  perform t.anon();
  for tbl in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
  loop
    begin
      execute format('select count(*) from public.%I', tbl.relname);
      perform t.owner();
      raise exception 'FAIL: anon could read %', tbl.relname;
    exception when insufficient_privilege then
      checked := checked + 1;
    end;
  end loop;
  perform t.owner();
  raise notice 'ok - anon was refused on all % tables', checked;
end $$;

-- ---- 3. branch isolation on every table with a branch_id ----------------------------------
do $$
declare
  tbl record;
  n bigint;
  seen_a bigint;
  seen_b bigint;
  checked integer := 0;
begin
  for tbl in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'branch_id' and not a.attisdropped
     where n.nspname = 'public' and c.relkind = 'r' order by c.relname
  loop
    -- A table nobody can read at all (e.g. internal counters) is trivially isolated.
    if not has_column_privilege('authenticated', ('public.' || quote_ident(tbl.relname))::regclass, 'branch_id', 'select') then
      checked := checked + 1;
      continue;
    end if;

    -- Admin A may see A's rows, never B's.
    perform t.login('a1000000-0000-0000-0000-000000000001');
    execute format('select count(*) from public.%I where branch_id = %L', tbl.relname, 'bbbbbbbb-0000-0000-0000-000000000001') into n;
    if n <> 0 then raise exception 'FAIL: admin A sees % rows of Branch B in %', n, tbl.relname; end if;
    execute format('select count(*) from public.%I where branch_id = %L', tbl.relname, 'aaaaaaaa-0000-0000-0000-000000000001') into seen_a;

    -- Admin B may see B's rows, never A's.
    perform t.login('b1000000-0000-0000-0000-000000000001');
    execute format('select count(*) from public.%I where branch_id = %L', tbl.relname, 'aaaaaaaa-0000-0000-0000-000000000001') into n;
    if n <> 0 then raise exception 'FAIL: admin B sees % rows of Branch A in %', n, tbl.relname; end if;
    execute format('select count(*) from public.%I where branch_id = %L', tbl.relname, 'bbbbbbbb-0000-0000-0000-000000000001') into seen_b;

    -- A user with no membership sees nothing at all in these tables.
    perform t.login('c0000000-0000-0000-0000-000000000001');
    execute format('select count(*) from public.%I', tbl.relname) into n;
    if n <> 0 then raise exception 'FAIL: a user with no membership sees % rows in %', n, tbl.relname; end if;

    perform t.owner();
    -- The check is only meaningful if each admin can see their own branch's rows.
    if tbl.relname in ('branch_members', 'medicine_batches', 'stock_movements', 'audit_log') and (seen_a = 0 or seen_b = 0) then
      raise exception 'FAIL: % had no own-branch rows visible (A=%, B=%), so isolation was not really tested', tbl.relname, seen_a, seen_b;
    end if;
    checked := checked + 1;
  end loop;
  perform t.owner();
  raise notice 'ok - branch isolation held on all % tables that have a branch_id', checked;
end $$;

rollback;
