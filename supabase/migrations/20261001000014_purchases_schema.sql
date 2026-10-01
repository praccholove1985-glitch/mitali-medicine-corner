-- Phase 7 / 1 of 3: suppliers, supplier ledger, purchases (tables).
--
-- A purchase is written once by public.create_purchase and never edited. Purchase returns
-- (Phase 8) are new documents. The supplier ledger is append-only: positive = we owe the
-- supplier, negative = we owe less. Cost columns are only reachable by users holding
-- purchase.view_cost, through policies and functions.
--
-- Error codes introduced (mapped in src/server/errors.ts):
--   PH059 duplicate_supplier_invoice   PH060 supplier_payment_exceeds_due
--   PH061 purchase_payment_exceeds_total   PH062 purchase_empty   PH063 batch_price_required

-- ---------------------------------------------------------------------------
-- Suppliers (per branch)
-- ---------------------------------------------------------------------------
create table public.suppliers (
  id              uuid primary key default gen_random_uuid(),
  branch_id       uuid not null references public.branches (id) on delete restrict,
  name            text not null check (length(btrim(name)) between 1 and 120),
  contact_person  text check (contact_person is null or length(contact_person) <= 120),
  phone           text check (phone is null or length(btrim(phone)) between 1 and 32),
  address         text check (address is null or length(address) <= 300),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  unique (id, branch_id)
);
create unique index suppliers_name_key on public.suppliers (branch_id, lower(btrim(name)));
create index suppliers_name_trgm on public.suppliers using gin (name extensions.gin_trgm_ops);

-- Append-only: positive = we owe the supplier more; negative = we owe less.
create table public.supplier_ledger_entries (
  id           bigint generated always as identity primary key,
  branch_id    uuid not null,
  supplier_id  uuid not null,
  entry_type   text not null check (entry_type in
    ('PURCHASE_DUE','PAYMENT','RETURN_CREDIT','OPENING_BALANCE','ADJUSTMENT')),
  amount       numeric(14,2) not null check (amount <> 0),
  purchase_id  uuid,
  payment_id   bigint,
  note         text,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  foreign key (supplier_id, branch_id) references public.suppliers (id, branch_id) on delete restrict,
  check (
    case entry_type
      when 'PURCHASE_DUE'  then amount > 0
      when 'PAYMENT'       then amount < 0
      when 'RETURN_CREDIT' then amount < 0
      else true
    end
  )
);
create index supplier_ledger_supplier_idx on public.supplier_ledger_entries (supplier_id, id desc);
create index supplier_ledger_branch_idx on public.supplier_ledger_entries (branch_id, id desc);
create index supplier_ledger_purchase_idx on public.supplier_ledger_entries (purchase_id) where purchase_id is not null;
create index supplier_ledger_payment_idx on public.supplier_ledger_entries (payment_id) where payment_id is not null;

-- ---------------------------------------------------------------------------
-- Purchases
-- ---------------------------------------------------------------------------
create table public.purchase_counters (
  branch_id  uuid primary key references public.branches (id) on delete restrict,
  last_seq   bigint not null default 0
);

create table public.purchases (
  id                   uuid primary key default gen_random_uuid(),
  branch_id            uuid not null references public.branches (id) on delete restrict,
  purchase_seq         bigint not null,
  purchase_no          text not null,
  supplier_id          uuid not null,
  supplier_invoice_no  text not null check (length(btrim(supplier_invoice_no)) between 1 and 64),
  invoice_date         date not null,
  subtotal             numeric(14,2) not null check (subtotal >= 0),
  discount_total       numeric(14,2) not null check (discount_total >= 0),
  tax_total            numeric(14,2) not null check (tax_total >= 0),
  grand_total          numeric(14,2) not null check (grand_total >= 0),
  paid_total           numeric(14,2) not null check (paid_total >= 0),
  due_total            numeric(14,2) not null check (due_total >= 0),
  notes                text check (notes is null or length(notes) <= 500),
  client_request_id    uuid not null,
  created_by           uuid default auth.uid(),
  created_at           timestamptz not null default now(),
  foreign key (supplier_id, branch_id) references public.suppliers (id, branch_id) on delete restrict,
  unique (id, branch_id),
  unique (branch_id, purchase_seq),
  unique (branch_id, client_request_id),
  check (subtotal - discount_total + tax_total = grand_total),
  check (paid_total + due_total = grand_total)
);
-- The same supplier invoice cannot be entered twice.
create unique index purchases_supplier_invoice_key
  on public.purchases (branch_id, supplier_id, lower(btrim(supplier_invoice_no)));
create index purchases_supplier_idx on public.purchases (supplier_id, purchase_seq desc);
create index purchases_branch_idx on public.purchases (branch_id, purchase_seq desc);

create table public.purchase_items (
  id                uuid primary key default gen_random_uuid(),
  purchase_id       uuid not null references public.purchases (id) on delete restrict,
  line_no           integer not null check (line_no > 0),
  medicine_id       uuid not null references public.medicines (id) on delete restrict,
  medicine_name     text not null,
  strength          text,
  unit              text not null,
  batch_id          uuid not null references public.medicine_batches (id) on delete restrict,
  batch_number      text not null,
  expiry_date       date not null,
  quantity          integer not null check (quantity >= 0),
  free_quantity     integer not null check (free_quantity >= 0),
  unit_price        numeric(14,4) not null check (unit_price >= 0),
  gross             numeric(14,2) not null check (gross >= 0),
  discount          numeric(14,2) not null check (discount >= 0),
  tax_rate          numeric(5,2) not null check (tax_rate between 0 and 100),
  tax_amount        numeric(14,2) not null check (tax_amount >= 0),
  line_total        numeric(14,2) not null check (line_total >= 0),
  -- line_total spread over paid + free units: what each unit really cost.
  unit_cost         numeric(14,4) not null check (unit_cost >= 0),
  new_batch         boolean not null,
  unique (purchase_id, line_no),
  check (quantity + free_quantity > 0),
  check (gross - discount + tax_amount = line_total)
);
create index purchase_items_batch_idx on public.purchase_items (batch_id);
create index purchase_items_medicine_idx on public.purchase_items (medicine_id);

-- ---------------------------------------------------------------------------
-- Batches and payments learn about suppliers and purchases
-- ---------------------------------------------------------------------------
alter table public.medicine_batches
  add foreign key (supplier_id, branch_id) references public.suppliers (id, branch_id) on delete restrict;
create index medicine_batches_supplier_idx on public.medicine_batches (supplier_id) where supplier_id is not null;

alter table public.payments add column supplier_id uuid;
alter table public.payments add column purchase_id uuid;
alter table public.payments
  add foreign key (supplier_id, branch_id) references public.suppliers (id, branch_id) on delete restrict;
alter table public.payments
  add foreign key (purchase_id, branch_id) references public.purchases (id, branch_id) on delete restrict;
create index payments_supplier_idx on public.payments (supplier_id) where supplier_id is not null;
create index payments_purchase_idx on public.payments (purchase_id) where purchase_id is not null;
-- Money out belongs to a supplier; money in never does.
alter table public.payments add check (direction <> 'OUT' or (sale_id is null and customer_id is null and supplier_id is not null));
alter table public.payments add check (direction <> 'IN' or (supplier_id is null and purchase_id is null));

alter table public.supplier_ledger_entries
  add foreign key (purchase_id) references public.purchases (id) on delete restrict;
alter table public.supplier_ledger_entries
  add foreign key (payment_id) references public.payments (id) on delete restrict;

-- ---------------------------------------------------------------------------
-- Housekeeping and immutability
-- ---------------------------------------------------------------------------
create trigger suppliers_touch before update on public.suppliers
  for each row execute function public.touch_updated_at();

create trigger supplier_ledger_immutable before update or delete on public.supplier_ledger_entries
  for each row execute function public.forbid_modification();
create trigger supplier_ledger_no_truncate before truncate on public.supplier_ledger_entries
  for each statement execute function public.forbid_modification();
create trigger purchases_immutable before update or delete on public.purchases
  for each row execute function public.forbid_modification();
create trigger purchases_no_truncate before truncate on public.purchases
  for each statement execute function public.forbid_modification();
create trigger purchase_items_immutable before update or delete on public.purchase_items
  for each row execute function public.forbid_modification();
create trigger purchase_items_no_truncate before truncate on public.purchase_items
  for each statement execute function public.forbid_modification();

-- Audit suppliers like the other master data.
create or replace function public.audit_row_change() returns trigger
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
    when 'profiles', 'companies', 'categories', 'subcategories', 'medicines' then
      v_branch := null;
      v_entity_id := v_row ->> 'id';
    when 'medicine_batches', 'customers', 'suppliers' then
      v_branch := (v_row ->> 'branch_id')::uuid;
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

create trigger suppliers_audit after insert or update or delete on public.suppliers
  for each row execute function public.audit_row_change();
