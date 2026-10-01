-- Phase 1 / 3 of 4: row-level security and table privileges.
--
-- Default deny. anon gets nothing. authenticated gets SELECT through policies
-- and a single narrow UPDATE (own name/phone). Every other write goes through
-- SECURITY DEFINER functions added in later phases (staff management is
-- Phase 14) or the service role.
--
-- RULE FOR EVERY FUTURE MIGRATION: a new table in `public` must enable RLS,
-- revoke default privileges and grant only what it needs. A test fails the build
-- if a table is added without RLS or if anon can touch it.

-- Stop Supabase-style default grants from leaking into new objects.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

alter table public.branches                  enable row level security;
alter table public.profiles                  enable row level security;
alter table public.permissions               enable row level security;
alter table public.role_permissions          enable row level security;
alter table public.branch_members            enable row level security;
alter table public.user_permission_overrides enable row level security;
alter table public.audit_log                 enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select on
  public.branches,
  public.profiles,
  public.permissions,
  public.role_permissions,
  public.branch_members,
  public.user_permission_overrides,
  public.audit_log
to authenticated;

-- Only these two columns are user-editable; is_active is not.
grant update (full_name, phone) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

create policy branches_select on public.branches
  for select to authenticated
  using (id in (select public.my_branches()));

create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.shares_branch_with(id));

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- The catalogue and the role bundles are not secret and the UI needs them.
create policy permissions_select on public.permissions
  for select to authenticated using (true);

create policy role_permissions_select on public.role_permissions
  for select to authenticated using (true);

create policy branch_members_select on public.branch_members
  for select to authenticated
  using (user_id = auth.uid() or public.has_permission(branch_id, 'staff.view'));

create policy overrides_select on public.user_permission_overrides
  for select to authenticated
  using (user_id = auth.uid() or public.has_permission(branch_id, 'staff.view'));

create policy audit_log_select on public.audit_log
  for select to authenticated
  using (
    case
      when branch_id is not null then public.has_permission(branch_id, 'audit.view')
      else exists (
        select 1
        from public.my_branches() as b
        where public.has_permission(b, 'audit.view')
      )
    end
  );
