-- Phase 1 / 4 of 4: permission catalogue and default role bundles.
-- Reference data the functions depend on, so it lives in a migration rather
-- than seed.sql. Idempotent. Later phases append permissions in their own
-- migrations.

-- Seeding the bundles is not a "permission change" worth auditing; later edits are.
alter table public.role_permissions disable trigger role_permissions_audit;

insert into public.permissions (code, description) values
  ('sale.create',        'Complete sales at the counter'),
  ('sale.discount',      'Give discounts above the standard limit'),
  ('sale.return',        'Process sales returns'),
  ('sale.view_all',      'See every sale, not just your own'),
  ('medicine.view',      'View the medicine catalogue'),
  ('medicine.edit',      'Create and edit medicines, companies and categories'),
  ('price.edit',         'Change prices'),
  ('batch.edit',         'Create and edit batches'),
  ('stock.view',         'View stock, batches and movements'),
  ('stock.adjust',       'Adjust stock, record damage and expiry write-offs'),
  ('stock.count',        'Enter stock count figures'),
  ('purchase.view',      'View purchases'),
  ('purchase.create',    'Record purchases'),
  ('purchase.return',    'Process purchase returns'),
  ('purchase.view_cost', 'See supplier cost prices'),
  ('customer.view',      'View customers and their ledgers'),
  ('customer.edit',      'Create and edit customers'),
  ('customer.payment',   'Record customer payments'),
  ('supplier.view',      'View suppliers and their ledgers'),
  ('supplier.edit',      'Create and edit suppliers'),
  ('supplier.payment',   'Record supplier payments'),
  ('expense.view',       'View expenses'),
  ('expense.create',     'Record expenses'),
  ('finance.view_profit','See profit and cost figures'),
  ('report.view',        'View all reports'),
  ('report.view_own',    'View reports limited to your own sales'),
  ('ocr.use',            'Upload purchase invoices for OCR'),
  ('sms.send',           'Send SMS messages'),
  ('staff.view',         'View staff, roles and permission overrides'),
  ('staff.manage',       'Manage staff, roles and permissions'),
  ('settings.view',      'View settings'),
  ('settings.edit',      'Change settings'),
  ('audit.view',         'View the audit log')
on conflict (code) do nothing;

-- ADMIN: everything.
insert into public.role_permissions (role, permission)
select 'ADMIN', code from public.permissions
on conflict do nothing;

-- MANAGER: everything except managing staff/permissions and changing settings.
insert into public.role_permissions (role, permission)
select 'MANAGER', code from public.permissions
where code not in ('staff.manage', 'settings.edit', 'report.view_own')
on conflict do nothing;

-- PHARMACIST: dispense, manage catalogue and stock, limited reports.
insert into public.role_permissions (role, permission) values
  ('PHARMACIST','sale.create'),
  ('PHARMACIST','sale.return'),
  ('PHARMACIST','medicine.view'),
  ('PHARMACIST','medicine.edit'),
  ('PHARMACIST','batch.edit'),
  ('PHARMACIST','stock.view'),
  ('PHARMACIST','stock.adjust'),
  ('PHARMACIST','stock.count'),
  ('PHARMACIST','customer.view'),
  ('PHARMACIST','customer.edit'),
  ('PHARMACIST','customer.payment'),
  ('PHARMACIST','report.view_own')
on conflict do nothing;

-- CASHIER: counter work only.
insert into public.role_permissions (role, permission) values
  ('CASHIER','sale.create'),
  ('CASHIER','medicine.view'),
  ('CASHIER','stock.view'),
  ('CASHIER','customer.view'),
  ('CASHIER','customer.edit'),
  ('CASHIER','customer.payment'),
  ('CASHIER','report.view_own')
on conflict do nothing;

-- STAFF: look-up and stock counting.
insert into public.role_permissions (role, permission) values
  ('STAFF','medicine.view'),
  ('STAFF','stock.view'),
  ('STAFF','stock.count')
on conflict do nothing;

alter table public.role_permissions enable trigger role_permissions_audit;
