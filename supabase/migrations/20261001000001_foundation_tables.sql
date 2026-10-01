-- Phase 1 / 1 of 4: tenancy, identity, permissions and audit tables.
--
-- Forward-only. Nothing here drops or rewrites existing data.
-- Every table has RLS enabled in 20261001000003; this file only defines shape.
--
-- Error codes raised by the application layer (see docs/DATABASE.md):
--   PH010 append_only_violation   (this phase)
--   PH001..PH0xx business errors  (later phases)


-- ---------------------------------------------------------------------------
-- Branches. One row today; every business table carries branch_id later.
-- ---------------------------------------------------------------------------
create table public.branches (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) > 0),
  timezone    text not null default 'Asia/Dhaka',
  currency    text not null default 'BDT' check (currency ~ '^[A-Z]{3}$'),
  address     text,
  phone       text,
  settings    jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Profiles. One per auth user, created by trigger. A profile grants NO access:
-- access comes only from an active branch membership.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null default '' check (length(full_name) <= 120),
  phone       text check (phone is null or length(phone) <= 32),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Permission catalogue and role bundles.
-- ---------------------------------------------------------------------------
create table public.permissions (
  code         text primary key check (code ~ '^[a-z_]+\.[a-z_]+$'),
  description  text not null
);

create table public.role_permissions (
  role        text not null check (role in ('ADMIN','MANAGER','PHARMACIST','CASHIER','STAFF')),
  permission  text not null references public.permissions (code) on delete cascade,
  primary key (role, permission)
);

create table public.branch_members (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  branch_id   uuid not null references public.branches (id) on delete restrict,
  role        text not null check (role in ('ADMIN','MANAGER','PHARMACIST','CASHIER','STAFF')),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  primary key (user_id, branch_id)
);
create index branch_members_branch_idx on public.branch_members (branch_id) where is_active;

-- Per-user exceptions to the role bundle. granted = true adds, false removes.
create table public.user_permission_overrides (
  user_id     uuid not null,
  branch_id   uuid not null,
  permission  text not null references public.permissions (code) on delete cascade,
  granted     boolean not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, branch_id, permission),
  foreign key (user_id, branch_id)
    references public.branch_members (user_id, branch_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Audit log. Append-only (enforced by trigger in 20261001000002).
-- branch_id is null for organisation-wide changes (role bundles).
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id           bigint generated always as identity primary key,
  branch_id    uuid references public.branches (id) on delete restrict,
  actor_id     uuid,
  action       text not null,
  entity_type  text not null,
  entity_id    text,
  old_values   jsonb,
  new_values   jsonb,
  created_at   timestamptz not null default now()
);
create index audit_log_branch_created_idx on public.audit_log (branch_id, created_at desc);
create index audit_log_entity_idx on public.audit_log (entity_type, entity_id);
create index audit_log_actor_idx on public.audit_log (actor_id, created_at desc);
