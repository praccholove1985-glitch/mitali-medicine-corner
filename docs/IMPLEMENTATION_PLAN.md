# Implementation Plan

Rule: build incrementally. After **every** phase run `tsc --noEmit`, lint, tests,
build, inspect affected UI, update docs. No phase starts with known errors.
A feature is done only when database, logic, authorisation, error handling, UI and
tests work together.

## Status

| Phase | Scope | Status |
|---|---|---|
| 0 | Architecture + setup | **In progress** — docs written; shadcn init and APK analysis pending (see Open items) |
| 1 | DB + Auth + RLS | Not started |
| 2 | App shell + design system | **Done** (built before Phase 1 at the owner's instruction; nav is not yet permission-aware) |
| 3 | Medicine master + batches | Not started |
| 4 | Inventory | Not started |
| 5 | Quick Sale / POS | Not started |
| 6 | Customers + ledger | Not started |
| 7 | Purchases + suppliers | Not started |
| 8 | Returns | Not started |
| 9 | Finance, expenses, profit | Not started |
| 10 | Reports | Not started |
| 11 | OCR | Not started |
| 12 | Barcode | Not started |
| 13 | SMS | Not started |
| 14 | Staff, permissions, audit | Not started |
| 15 | Offline / PWA | Not started |
| 16 | Testing, security, hardening | Not started |

## Phase details and exit criteria

**0 Setup** — repo scaffold ✔, docs ✔, shadcn init, Vitest + Playwright config,
ESLint rules (server-only boundaries), `.env.example`, CI (typecheck, lint, test,
build, secret scan), design tokens in `globals.css`.

**1 DB + Auth + RLS** — migrations for tenancy, profiles, memberships, roles/
permissions, audit_log; `has_permission`, `my_branches`; Supabase Auth wiring
(`proxy.ts`, SSR clients); seeds. *Exit*: RLS tests for every role and cross-branch
denial pass; append-only triggers tested.

**2 Shell + design system** — tokens, layout, nav (permission-aware), login, error
and empty states, `DataTable`, `MoneyText`. *Exit*: responsive checks at 4 widths,
keyboard path, axe clean.

**3 Medicine master + batches** — companies/categories, medicines CRUD (audited,
price-change audit), trigram search RPC, batch tables. *Exit*: search on 10k-row
seed < 100 ms (measured), uniqueness rules tested.

**4 Inventory** — stock list, per-batch view, movements ledger, adjustments, opening
stock, expiry and low-stock views, reconciliation view. *Exit*: movement/quantity
drift test = 0.

**5 POS** — `complete_sale`, FEFO, mixed payments, invoice, Quick Sale, idempotency.
*Exit*: tests for FEFO, deduction, expired prevention, partial/mixed payment,
concurrency (two parallel sales of last stock), historical cost.

**6 Customers + ledger** — customers, ledger, payments, statement, due.

**7 Purchases + suppliers** — suppliers, `create_purchase`, batch top-up, supplier
ledger, supplier payments.

**8 Returns** — sale and purchase returns with reversal of revenue/COGS/profit.

**9 Finance** — expenses, P&L, payment method summary.

**10 Reports** — server-side reports with ranges, pagination, CSV.

**11 OCR** — storage, Edge Function, REVIEW workflow, matching hierarchy.

**12 Barcode** — scanner input handling, camera scan, barcode on medicine/batch,
label printing (optional).

**13 SMS** — outbox, templates, provider adapter, due reminders, delivery log.

**14 Staff/permissions/audit** — invites, role editor, overrides, audit viewer.

**15 Offline/PWA** — manifest, service worker, catalogue cache, sale outbox with
idempotent replay and conflict UI.

**16 Hardening** — load test (10k medicines/100k sales/1M movements), advisor checks
(`get_advisors`), index review, backup/restore drill, security review, Vercel
production config.

## Git workflow

Branch per phase (`phase-N-...`), small commits (`feat:`/`fix:`/`docs:`/`test:`),
draft PR per phase, merge commit (no squash, no history rewrites). Secrets never
committed.

## Open items (blocking or decision needed)

1. **Reference APK missing.** `reference/pharmaStock-V9.0.apk` is not in the repo
   or the environment. Needed before the spec's `[APK-PENDING]` sections can be
   finalised. Upload it (commit under `reference/` or provide a download) and I
   will analyse navigation/screens and update the specs. Note: decompiling an APK
   is acceptable for a functional/UX reference only; no code/assets copied.
2. **shadcn/ui init blocked** — `ui.shadcn.com` returns 403 from this sandbox.
   Either run `npx shadcn@latest init` locally and push, or allow the host.
3. **Supabase project** — which project (URL, region) to use; none is connected to
   this session. Without it, migrations can be written and tested against local
   PostgreSQL only, not applied.
4. **DB test environment** — no Docker daemon in the sandbox, so `supabase start`
   is unavailable. Options: install PostgreSQL locally with an `auth` schema stub
   for RLS/RPC tests, and run the full Supabase stack in CI. Recommend both.
5. Owner decisions listed in PRODUCT_SPEC §7 and DATABASE §6 (units/strips,
   VAT-inclusive pricing, catalogue scope, expired-return rule, credit limits).
6. SMS gateway and OCR provider choices (Bangladesh coverage, cost, Bangla
   invoice accuracy).
7. Domain/brand: logo, invoice header/footer, BIN/VAT registration number for
   invoices.
