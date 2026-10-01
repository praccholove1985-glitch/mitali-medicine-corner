# Database Design (PostgreSQL / Supabase)

Status: Phase 1 is implemented (section 7 below). Sections 1-6 remain the design
for later phases; names there are proposals until their migration exists.

## 1. Conventions

- `uuid` primary keys (`gen_random_uuid()`), `created_at`/`updated_at timestamptz`.
- **Money**: `numeric(14,2)` for totals, `numeric(14,4)` for unit prices/costs
  (per-tablet cost like ৳1.125 must not be rounded early). Rounding is done once,
  in SQL, with a documented rule (round half up to 2 dp per line, then sum).
  App code treats money as decimal strings / integer paisa — **never JS floats**.
- **Quantities**: `integer` in the smallest sellable unit. Pack conversion lives on
  the medicine (`pack_size`). Fractional quantities are not supported in v1.
- Timestamps UTC; "business date" derived in `Asia/Dhaka` via a setting
  (`branches.timezone`).
- Every business table has `branch_id uuid not null references branches`.
- Enums as Postgres enums or `text` + check (prefer check constraints to keep
  migrations simple).
- RLS enabled on **every** table in `public`. No table without a policy decision.
- History tables are append-only: `UPDATE`/`DELETE` blocked by trigger and by
  revoked privileges.

## 2. Core entities

### Tenancy / identity
- `branches(id, name, timezone default 'Asia/Dhaka', currency default 'BDT', address, phone, settings jsonb)`
- `profiles(id → auth.users, full_name, phone, is_active)`
- `branch_members(user_id, branch_id, role, is_active, PK(user_id, branch_id))`
- `role_permissions(role, permission)` — default bundles
- `user_permission_overrides(user_id, branch_id, permission, granted bool)`

### Catalogue
- `companies(id, branch_id?, name, …)` — catalogue tables may be branch-shared
  (`branch_id null` = global); decision: **global within the organisation**, but
  keep `branch_id` nullable for future.
- `categories`, `subcategories(category_id, …)`
- `medicines` — fields per spec §4.1, plus `pack_size`, `search_text` (generated),
  `deleted`/`is_active`. Indexes: GIN trigram on `name`, `generic_name`,
  `brand_name`; btree unique partial on `barcode`, `sku` (`where not null`, per
  branch/org); btree on `company_id`, `category_id`.

### Inventory
- `medicine_batches(id, branch_id, medicine_id, supplier_id, batch_number, expiry_date, purchase_price, sale_price, mrp, quantity, source_purchase_item_id, created_at, updated_at)`
  - `check (quantity >= 0)`
  - Uniqueness: `unique (branch_id, medicine_id, supplier_id, batch_number, expiry_date)`
    — the same batch number may exist for different medicines/suppliers; the same
    medicine+supplier+batch+expiry is the same physical batch and is **topped up**,
    not duplicated. (Different expiry under the same number is treated as a
    distinct batch and flagged in the UI.)
  - Index for FEFO: `(branch_id, medicine_id, expiry_date) where quantity > 0`.
- `stock_movements(id, branch_id, medicine_id, batch_id, quantity_delta, movement_type, reference_type, reference_id, user_id, reason, created_at)`
  - `movement_type` ∈ PURCHASE, SALE, SALE_RETURN, PURCHASE_RETURN, ADJUSTMENT,
    DAMAGE, EXPIRED, TRANSFER, OPENING_STOCK, CORRECTION
  - `quantity_delta <> 0`; sign rules per type enforced by check/trigger.
  - Append-only. Indexes: `(batch_id, created_at)`, `(medicine_id, created_at)`,
    `(branch_id, created_at)`, `(reference_type, reference_id)`.
  - **Invariant**: `medicine_batches.quantity = sum(quantity_delta)` for that batch.
    A check view `v_stock_reconciliation` reports drift; a test asserts zero drift.

### Sales
- `sales(id, branch_id, invoice_no, customer_id null, sold_at, subtotal, discount_total, tax_total, grand_total, paid_total, due_total, status, cost_total, profit_total, client_request_id, created_by)`
  - `invoice_no` from a per-branch sequence table (gap-free not required, unique required).
  - `unique (branch_id, client_request_id)`.
- `sale_items(id, sale_id, medicine_id, quantity, unit_price, discount, tax_rate, tax_amount, line_total)`
- `sale_item_allocations(id, sale_item_id, batch_id, quantity, unit_cost, unit_price)`
  — **a line can span batches under FEFO**; cost is snapshotted per allocation.
  This is what makes historical profit immutable and returns exact.
- `payments(id, branch_id, direction ('IN'|'OUT'), method, amount, party_type, party_id, sale_id?, purchase_id?, reference, created_by, created_at)`
  — one row per method component; sum per sale validated by RPC.

### Returns
- `sale_returns(id, sale_id, return_no, reason, refund_method, total, created_by …)`
- `sale_return_items(id, sale_return_id, sale_item_id, allocation_id, quantity, unit_price_refund, unit_cost_reversed)`
  Restores quantity to the **original batch** (even if now expired → goes to
  quarantine movement type `EXPIRED`/restock decision by pharmacist, see workflows).
- `purchase_returns`, `purchase_return_items` (reduce batch; cannot exceed
  available quantity; supplier ledger credit).

### Purchases / suppliers
- `suppliers(id, branch_id, name, phone, address, …)`
- `purchases(id, branch_id, supplier_id, invoice_number, purchase_date, subtotal, discount_total, tax_total, grand_total, paid_total, due_total, status, client_request_id, ocr_document_id?)`
  `unique (branch_id, supplier_id, invoice_number)` to stop double entry.
- `purchase_items(id, purchase_id, medicine_id, batch_id, batch_number, expiry_date, quantity, free_quantity, purchase_price, discount, tax_rate, line_total)`
  Effective unit cost = line_total / (quantity + free_quantity) — stored on the batch.

### Ledgers (append-only)
- `customer_ledger_entries(id, branch_id, customer_id, entry_type, amount, sale_id?, payment_id?, return_id?, created_at, created_by, note)`
- `supplier_ledger_entries(…)` same shape with purchase/payment/return refs.
- **Sign convention (documented, fixed):** positive amount increases what the
  *party owes us* (customer) / what *we owe* (supplier). Balance =
  `sum(amount)`. Entry types: `SALE_DUE`, `PAYMENT`, `RETURN_CREDIT`,
  `OPENING_BALANCE`, `ADJUSTMENT`. Corrections are new entries.
- Views `v_customer_balance`, `v_supplier_balance`. No `balance` column that can
  be edited. (A denormalised cache, if needed for speed, is trigger-maintained and
  reconciled by test.)

### Finance
- `expense_categories`, `expenses(id, branch_id, category_id, amount, paid_method, expense_date, note, created_by)`
- Profit/loss = Σ sale allocation (price − cost) − returns reversed − expenses,
  derived by SQL, never stored on mutable master data.

### Platform
- `audit_log(id, branch_id, actor_id, action, entity_type, entity_id, old_values jsonb, new_values jsonb, created_at, ip?)` append-only.
- `customers(id, branch_id, name, phone, address, credit_limit null, is_active)`
  unique `(branch_id, phone)` where phone not null.
- `sms_outbox`, `sms_templates`, `ocr_documents`, `ocr_lines`, `app_settings`.

## 3. Business functions (RPC)

All `SECURITY DEFINER`, `set search_path = public, pg_temp`, actor = `auth.uid()`,
permission-checked inside, idempotent via `client_request_id`:

| Function | Notes |
|---|---|
| `complete_sale(payload jsonb)` | FEFO allocation, totals, payments, ledger, audit, returns invoice JSON |
| `receive_customer_payment(...)` | ledger PAYMENT entry |
| `create_purchase(payload jsonb)` | creates/tops-up batches, movements, supplier ledger |
| `pay_supplier(...)` | ledger PAYMENT entry |
| `create_sale_return(...)`, `create_purchase_return(...)` | reversal documents |
| `adjust_stock(...)` | ADJUSTMENT/DAMAGE/EXPIRED/CORRECTION with mandatory reason |
| `search_medicines(q, limit)` | ranked search with stock summary |
| Report functions | `report_sales(range, …)`, `report_profit`, … |

### FEFO selection (inside `complete_sale`)
```
eligible = batches where branch, medicine, quantity > 0,
           expiry_date > (now() at time zone branch.timezone)::date
order by expiry_date asc, created_at asc, id
lock FOR UPDATE (deterministic order → no deadlocks)
allocate greedily; if shortfall → raise PH001 (insufficient_stock)
```
Explicit batch pick by user must be eligible, else PH002.

### Concurrency
Row locks on batches in a fixed order; `check (quantity >= 0)` is the last line of
defence. Idempotency key prevents duplicate commits.

## 4. Index plan (initial)

medicines: trigram name/generic/brand; barcode; sku · batches: FEFO partial index,
`(branch_id, expiry_date)` for expiry report · stock_movements: see above ·
sales: `(branch_id, sold_at desc)`, `(customer_id, sold_at desc)` ·
ledgers: `(customer_id, created_at)`, `(supplier_id, created_at)` · audit_log:
`(branch_id, created_at desc)`, `(entity_type, entity_id)`.
Partition `stock_movements` and `audit_log` by month if volume demands (decide
from real metrics, not now).

## 5. Migration policy

Forward-only SQL migrations in `supabase/migrations`. No destructive change
without a backup/restore note in the migration header. Migrations never edited
after merge. Seed data (roles, permissions, default branch, expense categories)
in a separate seed file.

## 6. Known risks / decisions to confirm

- Numeric precision choice (4 dp unit price) vs. paisa integers.
- Restocking a returned item whose batch has meanwhile expired.
- Whether catalogue (medicines) is org-global or per-branch.
- Pack/strip selling model (see PRODUCT_SPEC §7).

## 7. As built — Phase 1 (identity, permissions, audit)

Migrations in `supabase/migrations/`, forward-only:

| File | Contents |
|---|---|
| `20261001000001_foundation_tables.sql` | `branches`, `profiles`, `permissions`, `role_permissions`, `branch_members`, `user_permission_overrides`, `audit_log` |
| `20261001000002_access_functions.sql` | `my_branches()`, `has_permission()`, `my_permissions()`, `shares_branch_with()`, profile-on-signup trigger, audit triggers, append-only trigger, `write_audit()`, `bootstrap_pharmacy()` |
| `20261001000003_rls_and_grants.sql` | RLS on every table, default-privilege lockdown, SELECT policies, the one narrow UPDATE |
| `20261001000004_reference_data.sql` | permission catalogue (33 codes) and default role bundles |

Decisions that differ from or refine the earlier design:
- **Access comes only from an active `branch_members` row.** A profile (created
  automatically at sign-up) grants nothing; a new account lands on a "no access
  yet" screen.
- **Role bundles are organisation-wide**, not per branch (`role_permissions` has no
  `branch_id`). Per-user exceptions are per branch (`user_permission_overrides`).
- **Authenticated users can only read**, plus update their own `full_name` and
  `phone`. All other writes arrive as `SECURITY DEFINER` functions in later phases
  (staff management: Phase 14) or via the service role.
- **Audit**: role-bundle, membership, override, branch/settings and profile
  active-flag changes are audited by trigger with old/new values. `audit_log`
  rejects UPDATE, DELETE and TRUNCATE (error `PH010`) even for the owner. Seeding
  the default bundles is deliberately not audited.
- **Security-definer functions** all pin `search_path`, take no user id parameter
  (the actor is always `auth.uid()`), and have `EXECUTE` revoked from `PUBLIC`.
  Only the four access helpers are granted to `authenticated`.
- `pgcrypto` is not installed: `gen_random_uuid()` is built in, and a `public`
  extension would add anon-executable functions (caught by the guard test).

### Operations

Apply migrations with the Supabase CLI (`supabase db push`) or the SQL editor, in
filename order, **to a project you have confirmed is the pharmacy project**.

First administrator (cannot be created through the API because nobody has
permission yet):
1. Create the user in Supabase Auth (dashboard → Authentication → Add user).
2. As the database owner or with the service role, run:
   `select public.bootstrap_pharmacy('Mitali Medicine Corner', 'owner@example.com');`
   It creates the branch and makes that user an ADMIN. It is idempotent.

Rollback: Phase 1 only creates new objects. To undo, drop the seven tables and the
functions listed above; there is no data to preserve until the first user is added.

### Tests

`scripts/db-test.sh` creates a throwaway database, applies a **test-only** stub of
the Supabase auth schema (`supabase/tests/stub/auth_stub.sql`), every migration,
then runs `supabase/tests/*.sql` (84 checks): structure guards (RLS on every table,
anon has nothing, definer functions pin search_path), role/override matrix, branch
isolation, inactive users, write denial, audit, sign-up and bootstrap, and the
session queries. Set `DATABASE_ADMIN_URL` to run it in CI. The stub is not a
substitute for running the migrations on real Supabase; do that on a branch or
scratch project before production.
