-- Phase 5 / 1 of 3: customers, customer ledger, sales, payments, drafts (tables).
--
-- A sale is written once by public.complete_sale and never edited. Returns (Phase 8)
-- are new documents that reverse it. Cost and profit columns are excluded from
-- authenticated's column privileges (20261001000012) and only reachable through
-- functions that check the relevant permission.
--
-- Error codes introduced (mapped in src/server/errors.ts):
--   PH001 insufficient_stock           PH044 batch_not_sellable
--   PH050 discount_invalid             PH051 payment_mismatch
--   PH052 discount_needs_permission    PH053 below_cost_needs_permission
--   PH054 rx_needs_pharmacist          PH055 credit_needs_customer
--   PH056 credit_limit_exceeded        PH057 empty_cart

-- New permission: dispensing prescription-only medicines.
insert into public.permissions (code, description) values
  ('sale.dispense_rx', 'Sell prescription-only medicines')
on conflict (code) do nothing;

alter table public.role_permissions disable trigger role_permissions_audit;
insert into public.role_permissions (role, permission) values
  ('ADMIN', 'sale.dispense_rx'),
  ('MANAGER', 'sale.dispense_rx'),
  ('PHARMACIST', 'sale.dispense_rx')
on conflict do nothing;
alter table public.role_permissions enable trigger role_permissions_audit;

-- ---------------------------------------------------------------------------
-- Customers (per branch). Walk-in sales have no customer row.
-- ---------------------------------------------------------------------------
create table public.customers (
  id            uuid primary key default gen_random_uuid(),
  branch_id     uuid not null references public.branches (id) on delete restrict,
  name          text not null check (length(btrim(name)) between 1 and 120),
  phone         text check (phone is null or length(btrim(phone)) between 1 and 32),
  address       text check (address is null or length(address) <= 300),
  -- null = no limit. Money the customer may owe at most.
  credit_limit  numeric(14,2) check (credit_limit is null or credit_limit >= 0),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  unique (id, branch_id)
);
create unique index customers_phone_key on public.customers (branch_id, btrim(phone)) where phone is not null;
create index customers_name_idx on public.customers (branch_id, lower(name));
create index customers_name_trgm on public.customers using gin (name extensions.gin_trgm_ops);

-- Append-only ledger. Positive = the customer owes more; negative = they owe less.
-- Balance is the sum of the entries; corrections are new entries, never edits.
create table public.customer_ledger_entries (
  id           bigint generated always as identity primary key,
  branch_id    uuid not null,
  customer_id  uuid not null,
  entry_type   text not null check (entry_type in
    ('SALE_DUE','PAYMENT','RETURN_CREDIT','OPENING_BALANCE','ADJUSTMENT')),
  amount       numeric(14,2) not null check (amount <> 0),
  sale_id      uuid,
  note         text,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  foreign key (customer_id, branch_id) references public.customers (id, branch_id) on delete restrict,
  -- Direction is fixed per type.
  check (
    case entry_type
      when 'SALE_DUE'      then amount > 0
      when 'PAYMENT'       then amount < 0
      when 'RETURN_CREDIT' then amount < 0
      else true
    end
  )
);
create index customer_ledger_customer_idx on public.customer_ledger_entries (customer_id, id desc);
create index customer_ledger_branch_idx on public.customer_ledger_entries (branch_id, id desc);
create index customer_ledger_sale_idx on public.customer_ledger_entries (sale_id) where sale_id is not null;

-- ---------------------------------------------------------------------------
-- Invoice numbering: one counter per branch, bumped inside the sale transaction.
-- ---------------------------------------------------------------------------
create table public.invoice_counters (
  branch_id  uuid primary key references public.branches (id) on delete restrict,
  last_seq   bigint not null default 0
);

-- ---------------------------------------------------------------------------
-- Sales
-- ---------------------------------------------------------------------------
create table public.sales (
  id                 uuid primary key default gen_random_uuid(),
  branch_id          uuid not null references public.branches (id) on delete restrict,
  invoice_seq        bigint not null,
  invoice_no         text not null,
  customer_id        uuid,
  sold_at            timestamptz not null default now(),
  status             text not null default 'COMPLETED' check (status in ('COMPLETED')),
  -- Gross before discount, discount, VAT included in the prices, amount to pay.
  subtotal           numeric(14,2) not null check (subtotal >= 0),
  discount_total     numeric(14,2) not null check (discount_total >= 0),
  tax_total          numeric(14,2) not null check (tax_total >= 0),
  grand_total        numeric(14,2) not null check (grand_total >= 0),
  paid_total         numeric(14,2) not null check (paid_total >= 0),
  due_total          numeric(14,2) not null check (due_total >= 0),
  -- Actual batch cost of what was sold, and the profit that leaves (revenue ex-VAT - cost).
  cost_total         numeric(14,4) not null check (cost_total >= 0),
  profit_total       numeric(14,4) not null,
  notes              text check (notes is null or length(notes) <= 500),
  client_request_id  uuid not null,
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  check (subtotal - discount_total = grand_total),
  check (paid_total + due_total = grand_total),
  check (due_total = 0 or customer_id is not null),
  foreign key (customer_id, branch_id) references public.customers (id, branch_id) on delete restrict,
  unique (id, branch_id)
);
create unique index sales_invoice_key on public.sales (branch_id, invoice_seq);
create unique index sales_invoice_no_key on public.sales (branch_id, invoice_no);
create unique index sales_request_key on public.sales (branch_id, client_request_id);
create index sales_branch_sold_idx on public.sales (branch_id, sold_at desc);
create index sales_customer_idx on public.sales (customer_id, sold_at desc) where customer_id is not null;
create index sales_created_by_idx on public.sales (branch_id, created_by, invoice_seq desc);

create table public.sale_items (
  id                uuid primary key default gen_random_uuid(),
  sale_id           uuid not null references public.sales (id) on delete restrict,
  line_no           integer not null check (line_no > 0),
  medicine_id       uuid not null references public.medicines (id) on delete restrict,
  -- Names as printed on the invoice, frozen at the time of sale.
  medicine_name     text not null,
  strength          text,
  unit              text not null,
  quantity          integer not null check (quantity > 0),
  gross             numeric(14,2) not null check (gross >= 0),
  discount          numeric(14,2) not null check (discount >= 0),
  tax_rate          numeric(5,2) not null check (tax_rate between 0 and 100),
  tax_amount        numeric(14,2) not null check (tax_amount >= 0),
  line_total        numeric(14,2) not null check (line_total >= 0),
  cost_total        numeric(14,4) not null check (cost_total >= 0),
  profit            numeric(14,4) not null,
  check (gross - discount = line_total),
  unique (sale_id, line_no)
);
create index sale_items_medicine_idx on public.sale_items (medicine_id);

-- One row per batch a line was taken from (a line can span batches under FEFO).
-- The cost is snapshotted here, so profit and returns never depend on today's prices.
create table public.sale_item_allocations (
  id            uuid primary key default gen_random_uuid(),
  sale_item_id  uuid not null references public.sale_items (id) on delete restrict,
  batch_id      uuid not null references public.medicine_batches (id) on delete restrict,
  batch_number  text not null,
  expiry_date   date not null,
  quantity      integer not null check (quantity > 0),
  unit_price    numeric(14,4) not null check (unit_price >= 0),
  unit_cost     numeric(14,4) not null check (unit_cost >= 0)
);
create index sale_item_allocations_item_idx on public.sale_item_allocations (sale_item_id);
create index sale_item_allocations_batch_idx on public.sale_item_allocations (batch_id);

-- Money actually received. Credit is not a payment: it is the sale's due amount,
-- recorded in the customer ledger.
create table public.payments (
  id           bigint generated always as identity primary key,
  branch_id    uuid not null references public.branches (id) on delete restrict,
  direction    text not null default 'IN' check (direction in ('IN','OUT')),
  method       text not null check (method in ('CASH','BKASH','NAGAD','ROCKET','CARD','BANK')),
  amount       numeric(14,2) not null check (amount > 0),
  sale_id      uuid,
  customer_id  uuid,
  reference    text check (reference is null or length(reference) <= 64),
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  foreign key (sale_id, branch_id) references public.sales (id, branch_id) on delete restrict,
  foreign key (customer_id, branch_id) references public.customers (id, branch_id) on delete restrict
);
create index payments_sale_idx on public.payments (sale_id) where sale_id is not null;
create index payments_branch_idx on public.payments (branch_id, id desc);
create index payments_customer_idx on public.payments (customer_id) where customer_id is not null;

-- ---------------------------------------------------------------------------
-- Saved carts. A draft holds only what to re-price later (medicine, quantity,
-- discount, batch); nothing in it is trusted at completion.
-- ---------------------------------------------------------------------------
create table public.sale_drafts (
  id           uuid primary key default gen_random_uuid(),
  branch_id    uuid not null references public.branches (id) on delete restrict,
  created_by   uuid not null default auth.uid(),
  name         text check (name is null or length(name) <= 80),
  customer_id  uuid,
  cart         jsonb not null check (jsonb_typeof(cart) = 'array' and jsonb_array_length(cart) <= 100),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  foreign key (customer_id, branch_id) references public.customers (id, branch_id) on delete restrict
);
create index sale_drafts_owner_idx on public.sale_drafts (branch_id, created_by, updated_at desc);
create index sale_drafts_customer_idx on public.sale_drafts (customer_id) where customer_id is not null;

-- ---------------------------------------------------------------------------
-- Housekeeping and immutability
-- ---------------------------------------------------------------------------
create trigger customers_touch before update on public.customers
  for each row execute function public.touch_updated_at();
create trigger sale_drafts_touch before update on public.sale_drafts
  for each row execute function public.touch_updated_at();

-- Sales, their lines, allocations, payments and ledger entries are history.
create trigger sales_immutable before update or delete on public.sales
  for each row execute function public.forbid_modification();
create trigger sale_items_immutable before update or delete on public.sale_items
  for each row execute function public.forbid_modification();
create trigger sale_item_allocations_immutable before update or delete on public.sale_item_allocations
  for each row execute function public.forbid_modification();
create trigger payments_immutable before update or delete on public.payments
  for each row execute function public.forbid_modification();
create trigger customer_ledger_immutable before update or delete on public.customer_ledger_entries
  for each row execute function public.forbid_modification();
create trigger sales_no_truncate before truncate on public.sales
  for each statement execute function public.forbid_modification();
create trigger sale_items_no_truncate before truncate on public.sale_items
  for each statement execute function public.forbid_modification();
create trigger sale_item_allocations_no_truncate before truncate on public.sale_item_allocations
  for each statement execute function public.forbid_modification();
create trigger payments_no_truncate before truncate on public.payments
  for each statement execute function public.forbid_modification();
create trigger customer_ledger_no_truncate before truncate on public.customer_ledger_entries
  for each statement execute function public.forbid_modification();

-- Audit customers like the other master data.
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
    when 'medicine_batches', 'customers' then
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

create trigger customers_audit after insert or update or delete on public.customers
  for each row execute function public.audit_row_change();
