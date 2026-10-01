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
- [ ] Migrations: branches, profiles, branch_members, roles/permissions, audit_log
- [ ] `my_branches()`, `has_permission()`
- [ ] Append-only triggers + revoked write privileges
- [ ] Auth wiring: `proxy.ts`, SSR clients, login/logout
- [ ] Seeds: roles, permissions, default branch
- [ ] RLS tests: each role, each table, cross-branch denial

## Phase 2 — Shell and design system
- [ ] Layout (sidebar, topbar, mobile drawer), permission-aware nav
- [ ] DataTable, MoneyText, StatusBadge, ExpiryBadge, EmptyState, ErrorState
- [ ] Error mapping (`server/errors.ts`) with tests
- [ ] Checked at 1440/1024/768/390 px, keyboard path, axe

## Phase 3 — Medicine master and batches
- [ ] Companies, categories, subcategories
- [ ] Medicines CRUD + audit (incl. price change)
- [ ] Trigram + barcode/SKU search RPC; 10k-row seed benchmark
- [ ] Batch tables + uniqueness rule tests

## Phase 4 — Inventory
- [ ] Stock list, batch view, movements list (keyset paginated)
- [ ] Adjustments / damage / expired / opening stock with reasons
- [ ] Expiry buckets, low-stock view
- [ ] Reconciliation view; drift test = 0

## Phase 5 — POS / Quick Sale
- [ ] `complete_sale` RPC (atomic, idempotent)
- [ ] FEFO incl. multi-batch split; expired-today rejected
- [ ] Mixed payments validated; credit requires customer
- [ ] Invoice numbering, invoice view/print
- [ ] Tests: FEFO, deduction, expired, partial, mixed, concurrency, historical cost
- [ ] POS UI: keyboard, touch, barcode input

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
