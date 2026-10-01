-- Phase 7 / 3 of 3: row-level security and privileges for the purchase tables.
-- Default deny; SELECT through policies; no direct writes. Purchase lines and the counter have no
-- grant at all: lines are read through get_purchase, which hides cost from roles without it.

alter table public.suppliers               enable row level security;
alter table public.supplier_ledger_entries enable row level security;
alter table public.purchase_counters       enable row level security;
alter table public.purchases               enable row level security;
alter table public.purchase_items          enable row level security;

revoke all on public.suppliers, public.supplier_ledger_entries, public.purchase_counters,
  public.purchases, public.purchase_items from anon, authenticated;

grant select on public.suppliers, public.supplier_ledger_entries, public.purchases to authenticated;

create policy suppliers_select on public.suppliers
  for select to authenticated
  using (public.has_permission(branch_id, 'supplier.view'));

create policy supplier_ledger_select on public.supplier_ledger_entries
  for select to authenticated
  using (public.has_permission(branch_id, 'supplier.view'));

-- Totals are what the shop paid its suppliers: cost information.
create policy purchases_select on public.purchases
  for select to authenticated
  using (public.has_permission(branch_id, 'purchase.view') and public.has_permission(branch_id, 'purchase.view_cost'));

-- Money going out is visible to those who see suppliers; money coming in keeps its sale rules.
drop policy payments_select on public.payments;
create policy payments_select on public.payments
  for select to authenticated
  using (
    case direction
      when 'IN' then
        public.has_permission(branch_id, 'sale.view_all')
        or (created_by = auth.uid() and public.has_permission(branch_id, 'sale.create'))
      else public.has_permission(branch_id, 'supplier.view')
    end
  );
