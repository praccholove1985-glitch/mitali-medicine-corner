-- Bootstrap the first administrator from a phone-auth user.
-- Run only by a trusted database owner or service role after creating the
-- Auth user in Supabase Dashboard. Never expose this function to app users.
create or replace function public.bootstrap_pharmacy_by_phone(
  p_branch_name text,
  p_admin_phone text
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_phone text := regexp_replace(btrim(p_admin_phone), '[[:space:]()-]', '', 'g');
  v_user uuid;
  v_branch uuid;
begin
  if v_phone ~ '^01[3-9][0-9]{8}$' then
    v_phone := '+880' || substr(v_phone, 2);
  elsif v_phone ~ '^8801[3-9][0-9]{8}$' then
    v_phone := '+' || v_phone;
  end if;

  select u.id into v_user
  from auth.users u
  where u.phone = v_phone;

  if v_user is null then
    raise exception 'No Auth user with phone %', v_phone using errcode = 'P0002';
  end if;

  insert into public.profiles (id)
  values (v_user)
  on conflict (id) do nothing;

  select b.id into v_branch
  from public.branches b
  where b.name = btrim(p_branch_name)
  limit 1;

  if v_branch is null then
    insert into public.branches (name, address, phone)
    values (btrim(p_branch_name), 'Boarding Market, Bangladesh', v_phone)
    returning id into v_branch;
  end if;

  insert into public.branch_members (user_id, branch_id, role)
  values (v_user, v_branch, 'ADMIN')
  on conflict (user_id, branch_id)
  do update set role = 'ADMIN', is_active = true;

  return v_branch;
end
$$;

revoke all on function public.bootstrap_pharmacy_by_phone(text, text) from public;
grant execute on function public.bootstrap_pharmacy_by_phone(text, text) to service_role;
