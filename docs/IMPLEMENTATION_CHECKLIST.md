# Implementation Checklist

Tick an item only when database, logic, authorisation, error handling, UI and tests
all work together. Gate for every phase: `tsc --noEmit`, lint, tests, build all
clean; affected UI inspected; docs updated.

## Phase 0 — Architecture and setup
- [x] Next.js 16 + TypeScript + Tailwind scaffold; Supabase client packages installed
- [x] Docs: PRODUCT_SPEC, ARCHITECTURE, DATABASE, SECURITY, UI_SYSTEM, PHARMACY_WORKFLOWS, IMPLEMENTATION_PLAN
- [x] This checklist
- [ ] **Reference APK analysed** (blocked: file not present — see plan, Open items)
- [ ] shadcn/ui initialised (blocked: `ui.shadcn.com` 403 in sandbox)
- [ ] Strict TS options confirmed (`strict`, `noUncheckedIndexedAccess`)
- [ ] Vitest + Playwright configured
- [ ] ESLint rule: admin client / `server/` importable from server code only
- [ ] `.env.example` (names only) and `.gitignore` verified
- [ ] CI: typecheck, lint, test, build, secret scan
- [ ] Design tokens in `globals.css`
- [ ] Owner decisions recorded (PRODUCT_SPEC §7, DATABASE §6)
- [ ] Supabase project chosen and connected

## Phase 1 — Database, Auth, RLS
- [x] Migrations: branches, profiles, branch_members, permissions, role bundles, overrides, audit_log
- [x] `my_branches()`, `has_permission()`, `my_permissions()`
- [x] Append-only audit log + audit triggers; write privileges revoked
- [x] RLS on every table; anon has nothing; guard tests fail the build on a new unprotected table
- [x] Reference data: 33 permission codes, five role bundles
- [x] Bootstrap function for the first administrator
- [x] Auth wiring: `proxy.ts`, server client, login/logout, no-access and setup screens
- [x] Permission-aware navigation, dashboard cards and shortcuts
- [x] Error mapping (`server/errors.ts`) with tests
- [x] DB tests: 84 checks (`scripts/db-test.sh`); mutation-checked
- [x] Foreign-key index guard and exhaustive RLS matrix test (Phase 1 re-verification)
- [ ] Apply migrations to a Supabase project (blocked: no project chosen)
- [ ] Exercise real sign-in, cookie refresh and the session queries against Supabase
- [ ] Run `scripts/db-test.sh` in CI
- [ ] Branch switcher (only needed once a user belongs to >1 branch)

## Phase 2 — Shell and design system
- [x] Layout (sidebar, tablet rail, topbar, mobile drawer)
- [x] Permission-aware nav (done in Phase 1)
- [x] Tokens, light + dark theme, typography (Geist + Noto Sans Bengali)
- [x] Button, Card, Input/Select/Textarea, Field, Badge, Alert, Table, Dialog, Sheet, Skeleton
- [x] DataTable (loading / error / empty / data), PageHeader, StatCard, MoneyText, Status/Expiry/Stock badges
- [x] Route error boundary, loading UI, 404
- [x] Money formatter with tests (`domain/money.ts`)
- [x] Error mapping (`server/errors.ts`) — done in Phase 1
- [x] Checked at 1440/1024/768/390 px, light and dark, reduced motion
- [x] Keyboard: skip link, drawer, dialog trap and focus return, inline form errors
- [ ] axe automated scan (axe not installed)

## Phase 3 — Medicine master and batches
- [x] Companies, categories, subcategories (create, rename, retire)
- [x] Medicines: create/edit with audit; price changes need `price.edit` and are audited
- [x] Search by name, generic, brand, company, barcode, SKU; 10k-row benchmark (28-62 ms)
- [x] Batches with expiry, cost, sale price, MRP; opening stock via `create_batch`
- [x] Batch uniqueness rules tested; same number allowed across medicines/expiry
- [x] `stock_movements` (append-only) and the commit-time stock invariant
- [x] Cost columns hidden from roles without `purchase.view_cost`
- [x] Screens: medicine list (search, paging), add/edit, batches card, companies & categories
- [x] Topbar search opens the medicine search
- [ ] Verify the screens against a live Supabase project
- [ ] Barcode fast path (decide in Phase 5 from POS needs)
- [ ] Batch edit beyond prices (expiry/number corrections) — Phase 4 adjustments
- [ ] Medicine image upload (Storage) — field exists, no upload UI yet

## Phase 4 — Inventory
- [x] Stock list by medicine (sellable vs expired, nearest expiry, batches, value at cost)
- [x] Filters: in stock, low, out, expiring, expired, all; search; paging
- [x] Summary cards; dashboard stock cards and expiry panel now use real data
- [x] Stock history with keyset paging and filters (medicine, batch, type)
- [x] Adjustments (count, correction, damage, expired) with mandatory reason and idempotency
- [x] Expiry watch with 30/60/90-day buckets and write-off of expired stock
- [x] Reconciliation function; drift test = 0 after every flow, and detects injected drift
- [x] Opening stock (Phase 3 `create_batch`) shows in the history
- [ ] Verify the screens against a live Supabase project
- [ ] Stocktake mode (counted vs system, approval) — `stock.count` permission unused until then
- [ ] Low-stock reorder suggestions per supplier (needs Phase 7 suppliers)

## Phase 5 — POS / Quick Sale
- [x] `complete_sale` RPC (atomic, idempotent via client request id)
- [x] FEFO incl. multi-batch split; expired-today rejected
- [x] Mixed payments validated to the paisa; credit requires customer and respects credit limit
- [x] Discount (none/amount/percent) with branch limit; below-cost and Rx need permissions
- [x] Gap-free per-branch invoice numbers, invoice view and print
- [x] Sale history, draft sales, customer search and quick add
- [x] Tests: FEFO, deduction, expired, partial, mixed, atomicity, idempotency, historical cost, rounding vectors
- [x] Real multi-connection concurrency test (`scripts/db-concurrency-test.sh`)
- [x] POS UI: search, barcode field, keyboard shortcuts (F2/F4), batch picker, payment dialog
- [ ] Inspect the terminal in a browser against a live Supabase project
- [ ] Sales returns — Phase 8; customer payments and statements UI — Phase 6
- [ ] Camera barcode scanning — Phase 12; offline sale outbox — Phase 15

## Phase 6 — Customers and ledger
- [ ] Customers, phone search, ledger (append-only), payments, statement, due

## Phase 7 — Purchases and suppliers
- [ ] Suppliers, `create_purchase`, batch top-up, free qty cost
- [ ] Supplier ledger, supplier payments; duplicate invoice guard

## Phase 8 — Returns
- [ ] Sale return (original batch, revenue/COGS/profit reversal, ledger)
- [ ] Purchase return; tests incl. partial and repeat returns

## Phase 9 — Finance
- [ ] Expenses + categories, P&L from historical cost, method summaries

## Phase 10 — Reports
- [ ] Sales, purchases, profit, expenses, inventory, movements, customer/supplier due, staff sales, expiry, low stock
- [ ] Ranges (today, yesterday, 7d, 30d, month, custom), pagination, CSV
- [ ] Dashboard KPIs + charts from real queries

## Phase 11 — OCR
- [ ] Private storage, Edge Function, REVIEW state, matching hierarchy, create/select/ignore

## Phase 12 — Barcode
- [ ] Scanner + camera scanning, barcode assignment, label printing (optional)

## Phase 13 — SMS
- [ ] Outbox, templates, provider adapter, due reminders, delivery log

## Phase 14 — Staff, permissions, audit
- [ ] Invites/disable, role editor, overrides, audit viewer, permission tests

## Phase 15 — Offline / PWA
- [ ] Manifest, service worker, catalogue cache, sale outbox, conflict UI

## Phase 16 — Hardening
- [ ] Load test (10k medicines / 100k sales / 1M movements)
- [ ] Supabase advisors clean, index review
- [ ] Backup/restore drill, security review, Vercel production config
