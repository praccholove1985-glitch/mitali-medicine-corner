-- Phase 1 / 2 of 4: helper functions, triggers and the audit mechanism.
--
-- Every SECURITY DEFINER function pins search_path and derives the actor from
-- auth.uid(); none accepts a user id from the caller (so a user id cannot be
-- spoofed through them).

-- ---------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------
create function public.touch_updated_at() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger branches_touch before update on public.branches
  for each row execute function public.touch_updated_at();
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

create function public.validate_branch_timezone() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Unknown timezone: %', new.timezone using errcode = '22023';
  end if;
  return new;
end $$;

create trigger branches_validate_timezone before insert or update of timezone on public.branches
  for each row execute function public.validate_branch_timezone();

-- ---------------------------------------------------------------------------
-- Access helpers used by RLS policies and RPCs.
-- ---------------------------------------------------------------------------

-- Branches the current user may act in: active user, active profile, active branch.
create function public.my_branches() returns setof uuid
language sql stable security definer
set search_path = public, pg_temp
as $$
  select m.branch_id
  from public.branch_members m
  join public.profiles p on p.id = m.user_id
  join public.branches b on b.id = m.branch_id
  where m.user_id = auth.uid()
    and m.is_active and p.is_active and b.is_active
$$;

-- Role bundle plus per-user override. An override (grant or revoke) wins.
create function public.has_permission(p_branch uuid, p_permission text) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.branch_members m
    join public.profiles p on p.id = m.user_id
    join public.branches b on b.id = m.branch_id
    where m.user_id = auth.uid()
      and m.branch_id = p_branch
      and m.is_active and p.is_active and b.is_active
      and coalesce(
        (select o.granted
           from public.user_permission_overrides o
          where o.user_id = m.user_id
            and o.branch_id = m.branch_id
            and o.permission = p_permission),
        exists (select 1
                  from public.role_permissions rp
                 where rp.role = m.role
                   and rp.permission = p_permission)
      )
  )
$$;

-- Effective permission codes for the current user in a branch (drives the UI;
-- the database still re-checks on every operation).
create function public.my_permissions(p_branch uuid) returns setof text
language sql stable security definer
set search_path = public, pg_temp
as $$
  select c.code
  from public.permissions c
  where public.has_permission(p_branch, c.code)
  order by c.code
$$;

-- Is the other user a member of a branch the current user belongs to?
-- Lets colleagues see each other's names without exposing every profile.
create function public.shares_branch_with(p_user uuid) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.branch_members mine
    join public.branch_members theirs on theirs.branch_id = mine.branch_id
    where mine.user_id = auth.uid()
      and mine.is_active
      and theirs.user_id = p_user
  )
$$;

-- ---------------------------------------------------------------------------
-- Profile creation. A new sign-up gets a profile and nothing else.
-- ---------------------------------------------------------------------------
create function public.handle_new_user() returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 120))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Audit: append-only table, a writer for RPCs, and row-change triggers.
-- ---------------------------------------------------------------------------
create function public.forbid_modification() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception '% is append-only', tg_table_name
    using errcode = 'PH010';
end $$;

create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function public.forbid_modification();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function public.forbid_modification();

-- For business RPCs in later phases. Not callable from the API.
create function public.write_audit(
  p_branch uuid,
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_old jsonb,
  p_new jsonb
) returns void
language sql security definer
set search_path = public, pg_temp
as $$
  insert into public.audit_log (branch_id, actor_id, action, entity_type, entity_id, old_values, new_values)
  values (p_branch, auth.uid(), p_action, p_entity_type, p_entity_id, p_old, p_new)
$$;

create function public.audit_row_change() returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_branch uuid;
  v_entity_id text;
begin
  case tg_table_name
    when 'branches' then
      v_branch := (v_row ->> 'id')::uuid;
      v_entity_id := v_row ->> 'id';
    when 'branch_members' then
      v_branch := (v_row ->> 'branch_id')::uuid;
      v_entity_id := (v_row ->> 'user_id') || ':' || (v_row ->> 'branch_id');
    when 'user_permission_overrides' then
      v_branch := (v_row ->> 'branch_id')::uuid;
      v_entity_id := (v_row ->> 'user_id') || ':' || (v_row ->> 'branch_id') || ':' || (v_row ->> 'permission');
    when 'role_permissions' then
      v_branch := null;
      v_entity_id := (v_row ->> 'role') || ':' || (v_row ->> 'permission');
    when 'profiles' then
      v_branch := null;
      v_entity_id := v_row ->> 'id';
    else
      raise exception 'audit_row_change is not configured for %', tg_table_name;
  end case;

  insert into public.audit_log (branch_id, actor_id, action, entity_type, entity_id, old_values, new_values)
  values (
    v_branch,
    auth.uid(),
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    v_entity_id,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

create trigger branches_audit after insert or update or delete on public.branches
  for each row execute function public.audit_row_change();
create trigger branch_members_audit after insert or update or delete on public.branch_members
  for each row execute function public.audit_row_change();
create trigger user_permission_overrides_audit after insert or update or delete on public.user_permission_overrides
  for each row execute function public.audit_row_change();
create trigger role_permissions_audit after insert or update or delete on public.role_permissions
  for each row execute function public.audit_row_change();
create trigger profiles_active_audit after update on public.profiles
  for each row when (old.is_active is distinct from new.is_active)
  execute function public.audit_row_change();

-- ---------------------------------------------------------------------------
-- Bootstrap. The first administrator cannot be created through the API (nobody
-- has permission yet), so this runs with the service role or as the database
-- owner: select public.bootstrap_pharmacy('Mitali Medicine Corner', 'owner@example.com');
-- The user must already exist in Auth. Idempotent.
-- ---------------------------------------------------------------------------
create function public.bootstrap_pharmacy(p_branch_name text, p_admin_email text) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid;
  v_branch uuid;
begin
  select u.id into v_user from auth.users u where lower(u.email) = lower(btrim(p_admin_email));
  if v_user is null then
    raise exception 'No auth user with email %', p_admin_email using errcode = 'P0002';
  end if;

  insert into public.profiles (id) values (v_user) on conflict (id) do nothing;

  select b.id into v_branch from public.branches b where b.name = btrim(p_branch_name) limit 1;
  if v_branch is null then
    insert into public.branches (name) values (btrim(p_branch_name)) returning id into v_branch;
  end if;

  insert into public.branch_members (user_id, branch_id, role)
  values (v_user, v_branch, 'ADMIN')
  on conflict (user_id, branch_id) do update set role = 'ADMIN', is_active = true;

  return v_branch;
end $$;

-- ---------------------------------------------------------------------------
-- Function privileges: nothing is callable by default.
-- ---------------------------------------------------------------------------
revoke all on function public.touch_updated_at() from public;
revoke all on function public.validate_branch_timezone() from public;
revoke all on function public.my_branches() from public;
revoke all on function public.has_permission(uuid, text) from public;
revoke all on function public.my_permissions(uuid) from public;
revoke all on function public.shares_branch_with(uuid) from public;
revoke all on function public.handle_new_user() from public;
revoke all on function public.forbid_modification() from public;
revoke all on function public.write_audit(uuid, text, text, text, jsonb, jsonb) from public;
revoke all on function public.audit_row_change() from public;
revoke all on function public.bootstrap_pharmacy(text, text) from public;

-- Used inside RLS policies, which run with the caller's privileges.
grant execute on function public.my_branches() to authenticated;
grant execute on function public.has_permission(uuid, text) to authenticated;
grant execute on function public.my_permissions(uuid) to authenticated;
grant execute on function public.shares_branch_with(uuid) to authenticated;

-- Bootstrap is server-side only.
grant execute on function public.bootstrap_pharmacy(text, text) to service_role;
