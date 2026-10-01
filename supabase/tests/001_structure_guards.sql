-- Guards that fail the build when a future migration forgets security basics.
begin;

-- Every table in public has RLS on.
select t.ok(
  (select count(*) = 0
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity),
  'every public table has row level security enabled');

-- anon touches nothing: no table, sequence or function privileges.
select t.ok(
  (select count(*) = 0
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','p','v','m')
      and (has_table_privilege('anon', c.oid, 'select')
        or has_table_privilege('anon', c.oid, 'insert')
        or has_table_privilege('anon', c.oid, 'update')
        or has_table_privilege('anon', c.oid, 'delete'))),
  'anon has no privileges on any public table');

select t.ok(
  (select count(*) = 0
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')),
  'anon cannot execute any public function');

-- authenticated is read-only except the two profile columns.
select t.ok(
  (select count(*) = 0
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','p')
      and (has_table_privilege('authenticated', c.oid, 'insert')
        or has_table_privilege('authenticated', c.oid, 'delete')
        or has_table_privilege('authenticated', c.oid, 'truncate')
        or (c.relname <> 'profiles' and has_table_privilege('authenticated', c.oid, 'update')))),
  'authenticated has no insert/update/delete on tables except profiles update');

select t.ok(
  not has_column_privilege('authenticated', 'public.profiles', 'is_active', 'update')
  and has_column_privilege('authenticated', 'public.profiles', 'full_name', 'update'),
  'authenticated may update profile name but not is_active');

-- Every SECURITY DEFINER function pins its search_path.
select t.ok(
  (select count(*) = 0
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%')),
  'every SECURITY DEFINER function pins search_path');

-- Internal functions are not callable by the API roles.
select t.ok(
  not has_function_privilege('authenticated', 'public.write_audit(uuid,text,text,text,jsonb,jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.bootstrap_pharmacy(text,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.audit_row_change()', 'execute')
  and not has_function_privilege('authenticated', 'public.handle_new_user()', 'execute'),
  'write_audit, bootstrap_pharmacy and trigger functions are not executable by authenticated');

select t.ok(
  has_function_privilege('service_role', 'public.bootstrap_pharmacy(text,text)', 'execute'),
  'bootstrap_pharmacy is executable by service_role');

-- Cost never leaves through a plain table read.
select t.ok(
  not has_column_privilege('authenticated', 'public.medicines', 'default_purchase_price', 'select')
  and not has_column_privilege('authenticated', 'public.medicine_batches', 'purchase_price', 'select')
  and has_column_privilege('authenticated', 'public.medicines', 'default_sale_price', 'select'),
  'authenticated cannot select cost columns but can select sale prices');

-- Internal helpers are not part of the API surface.
select t.ok(
  not has_function_privilege('authenticated', 'public.require_permission(uuid,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.require_permission_any(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.branch_today(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.check_batch_stock_invariant()', 'execute'),
  'permission helpers, branch_today and the invariant trigger are not executable by authenticated');

-- Extensions live outside public (as on Supabase).
select t.ok(
  (select count(*) = 0 from pg_extension e join pg_namespace n on n.oid = e.extnamespace
    where n.nspname = 'public' and e.extname <> 'plpgsql'),
  'no extension is installed in the public schema');

rollback;
