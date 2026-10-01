-- Phase 5 / 3 of 3: row-level security and privileges for the sales tables.
-- Same rules as before: default deny, SELECT through policies, no direct writes.

alter table public.customers               enable row level security;
alter table public.customer_ledger_entries enable row level security;
alter table public.invoice_counters        enable row level security;
alter table public.sales                   enable row level security;
alter table public.sale_items              enable row level security;
alter table public.sale_item_allocations   enable row level security;
alter table public.payments                enable row level security;
alter table public.sale_drafts             enable row level security;

revoke all on public.customers, public.customer_ledger_entries, public.invoice_counters,
  public.sales, public.sale_items, public.sale_item_allocations, public.payments, public.sale_drafts
  from anon, authenticated;

grant select on public.customers, public.customer_ledger_entries, public.payments, public.sale_drafts
  to authenticated;

-- Cost and profit stay out of reach of plain reads.
grant select (
  id, branch_id, invoice_seq, invoice_no, customer_id, sold_at, status,
  subtotal, discount_total, tax_total, grand_total, paid_total, due_total,
  notes, client_request_id, created_by, created_at
) on public.sales to authenticated;

grant select (
  id, sale_id, line_no, medicine_id, medicine_name, strength, unit, quantity,
  gross, discount, tax_rate, tax_amount, line_total
) on public.sale_items to authenticated;

grant select (
  id, sale_item_id, batch_id, batch_number, expiry_date, quantity, unit_price
) on public.sale_item_allocations to authenticated;

-- invoice_counters has RLS and no policy and no grant: only the functions touch it.

create policy customers_select on public.customers
  for select to authenticated
  using (public.has_permission(branch_id, 'customer.view'));

create policy customer_ledger_select on public.customer_ledger_entries
  for select to authenticated
  using (public.has_permission(branch_id, 'customer.view'));

-- A sale is visible to its cashier (while they can still sell) and to sale.view_all.
create policy sales_select on public.sales
  for select to authenticated
  using (
    public.has_permission(branch_id, 'sale.view_all')
    or (created_by = auth.uid() and public.has_permission(branch_id, 'sale.create'))
  );

create policy sale_items_select on public.sale_items
  for select to authenticated
  using (exists (select 1 from public.sales s where s.id = sale_id));

create policy sale_item_allocations_select on public.sale_item_allocations
  for select to authenticated
  using (exists (
    select 1 from public.sale_items i join public.sales s on s.id = i.sale_id
     where i.id = sale_item_id));

create policy payments_select on public.payments
  for select to authenticated
  using (
    public.has_permission(branch_id, 'sale.view_all')
    or (created_by = auth.uid() and public.has_permission(branch_id, 'sale.create'))
  );

create policy sale_drafts_select on public.sale_drafts
  for select to authenticated
  using (created_by = auth.uid() and public.has_permission(branch_id, 'sale.create'));
