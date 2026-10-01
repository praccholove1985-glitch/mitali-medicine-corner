# Mitali Medicine Corner — Product Specification

Status: Phase 0 draft. Source of requirements: the project brief. Sections marked
**[APK-PENDING]** are to be reconciled against the reference APK, which was **not
available** in the repository or the build environment when this was written
(`reference/pharmaStock-V9.0.apk` does not exist). Nothing in this document claims
to describe that APK. See `IMPLEMENTATION_PLAN.md` → "Open items".

## 1. Goal

A production pharmacy management, inventory, POS and accounting system for a real
pharmacy in Bangladesh. Multi-branch-ready from day one, single branch in practice.

## 2. Users and roles

| Role | Typical person | Summary |
|---|---|---|
| ADMIN | Owner | Everything, incl. users, permissions, settings, audit log |
| MANAGER | Shop manager | Operations, purchases, returns, reports, expenses; no permission/role edits |
| PHARMACIST | Dispenser | Sell, view stock, manage medicines/batches, handle Rx-required items |
| CASHIER | Counter | Sell, take customer payments, view own sales |
| STAFF | Helper | View stock/expiry, stock counts if granted |

Roles are bundles of fine-grained permissions (see `SECURITY.md`). Enforcement is in
the database, never only in the UI.

## 3. Capabilities (scope)

POS and Quick Sale · medicine master (companies, categories, subcategories) ·
batches · inventory · expiry tracking · FEFO · purchases · purchase returns ·
sales returns · customers + ledger · suppliers + ledger · payments · expenses ·
profit/loss · reports · barcode · invoice printing · OCR purchase invoices · SMS ·
staff · permissions · audit log · offline-aware POS · PWA · multi-branch readiness.

## 4. Functional requirements

### 4.1 Medicine master
Fields: id, name, generic_name, brand_name, company_id, category_id, subcategory_id,
strength, dosage_form, unit, barcode, sku, default_purchase_price,
default_sale_price, mrp, minimum_stock, reorder_level, prescription_required,
tax_rate, description, image_url, is_active, created_at, updated_at.
The master is a catalogue, **not inventory**. Stock exists only in batches.
Deactivate, never delete, a medicine that has history.

### 4.2 Batches
A medicine has many batches (supplier, batch number, expiry, cost, sale price, MRP,
quantity). Batches of the same medicine stay separate. Batch numbers are not
globally unique (see `DATABASE.md` for the uniqueness rule).

### 4.3 FEFO and expiry
Sales consume eligible batches earliest-expiry first. Expired batches are never
sellable. A batch whose expiry date is today **is expired** (sellable only while
`expiry_date > today` in the pharmacy timezone, default `Asia/Dhaka`).
Cashier may override batch choice only among eligible batches, and the override is
audited.

### 4.4 POS / Quick Sale
- Search: name, generic, brand, company, barcode, SKU; debounced, server-side.
- Barcode: hardware scanner (keyboard wedge) and camera scan.
- Cart line: medicine, batch(es), expiry, qty, unit price, discount, tax, subtotal,
  cost, profit. Cost/profit are **displayed to permitted roles only** and
  computed by the server.
- Payment methods: Cash, bKash, Nagad, Rocket, Card, Bank, Credit; mixed payment.
  Components must sum to the server-computed invoice total; Credit requires a
  registered customer.
- Walk-in or registered customer; phone search.
- Output: invoice (print/PDF/share). Completion is a single atomic server call.
- Quick Sale: minimal-tap variant of the same flow (same RPC, fewer fields).
- Prescription-required items need pharmacist/above or an explicit recorded
  confirmation (rule documented in `PHARMACY_WORKFLOWS.md`).

### 4.5 Customers
Walk-in + registered; search by name/phone; ledger, payments, due, statement,
SMS due reminder.

### 4.6 Suppliers, purchases
Supplier master, purchase entry (invoice no., date, items with batch/expiry/qty/
free qty/cost/discount/VAT), payment, supplier due, supplier ledger.

### 4.7 Returns
Sales returns and purchase returns are new reversing documents. Originals are never
edited or deleted.

### 4.8 Finance
Expenses (categories), profit/loss from historical batch cost, payment method
balances, cash drawer summary.

### 4.9 Reports (server-side)
Sales, purchases, profit, expenses, inventory, stock movement, customer due,
supplier due, staff sales, expiry, low stock. Ranges: today, yesterday, 7 days,
30 days, month, custom. Paginated, sortable, exportable (CSV).

### 4.10 Dashboard
Today's sales/profit/purchases, stock value, customer due, supplier due, low stock,
expiring soon, plus charts — all from database queries.

### 4.11 OCR purchase invoices
Upload image/PDF → provider extraction → **REVIEW** state → human confirms →
purchase is created through the normal purchase path. Never auto-committed.
Matching order: barcode → exact name → SKU → generic+strength → fuzzy. No match →
"Medicine not found": Create medicine / Select existing / Ignore.

### 4.12 SMS
Provider-agnostic send via Edge Function; templates; delivery log; due reminders,
invoice SMS. Secrets server-side only.

### 4.13 Staff, permissions, audit
Invite/disable staff, role + per-user overrides, immutable audit trail of sales,
returns, purchases, payments, expenses, adjustments, medicine/price changes,
permission and settings changes (user, time, entity, old/new values).

### 4.14 Offline / PWA
Installable PWA. POS stays usable for catalogue lookup offline; offline sale
submission is queued with an idempotency key and **validated by the server on
reconnect** (may be rejected, e.g. stock gone). Detailed in `ARCHITECTURE.md`.

## 5. Non-functional requirements

- Scale assumptions: 10k+ medicines, 100k+ sales, millions of stock movements.
  No table is ever loaded wholesale into the browser.
- Accuracy: money is exact decimal; no floating point in money paths.
- Locale: BDT (৳), `Asia/Dhaka`, Bengali-capable text (Unicode names, Bangla
  customer names); UI language English first, i18n-ready.
- Accessibility: keyboard-first POS, visible focus, labelled forms, accessible
  dialogs, status never by colour alone.
- Errors: no raw database errors to users; mapped, logged server-side.
- Every async surface has loading / success / error / empty states.

## 6. Out of scope for v1 (documented, not forgotten)

Inter-branch transfers UI (schema supports `TRANSFER` movement), e-commerce,
insurance claims, e-prescriptions, accounting-package export, controlled-drug
register (flag only; legal requirements need local confirmation).

## 7. Assumptions to confirm with the owner

1. Single currency BDT; tax is VAT %, per medicine, price inclusive or exclusive
   (default: sale price **VAT-inclusive**, as MRP is in Bangladesh).
2. Units: stock is counted in the smallest sellable unit (tablet/ml/piece);
   strip/box are pack conversions on the medicine (`pack_size`). Confirm whether
   strips and loose tablets are both sold.
3. Customer credit has no limit by default; optional per-customer limit.
4. Back-dated sales/purchases are admin/manager only.
5. One shared cash drawer per branch.
