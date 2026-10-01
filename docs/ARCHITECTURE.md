# Architecture

Stack: Next.js 16 (App Router, React 19) · strict TypeScript · Tailwind CSS 4 ·
shadcn/ui · Supabase (PostgreSQL, Auth, Storage, Edge Functions) · Vercel.

> Next.js 16 differs from older versions (e.g. `middleware.ts` is now `proxy.ts`).
> Consult `node_modules/next/dist/docs/` before writing framework code.

## 1. Principles

1. **The database is the source of truth.** Stock, totals, dues, balances, profit
   are computed and validated in PostgreSQL. The client may *display* a preview but
   its numbers are never trusted or persisted.
2. **One business operation = one transaction.** Sales, purchases, returns,
   payments and adjustments are Postgres functions (RPC) that do everything
   atomically. No sequence of unrelated browser requests.
3. **Append-only history.** Stock movements, ledger entries and audit rows are never
   updated or deleted. Corrections are new reversing rows.
4. **Secrets never reach the browser.** Service-role key, SMS and OCR credentials
   live only in server runtime / Edge Function secrets.
5. **Thin UI.** No pharmacy arithmetic in React components.

## 2. Layers

```
src/
  app/                    # routes, layouts, server actions entrypoints (thin)
  components/
    ui/                   # shadcn primitives
    <feature>/            # feature components (presentational + hooks)
  domain/                 # PURE business logic, no I/O, fully unit-tested
    money.ts              # decimal/paisa arithmetic, rounding rules
    fefo.ts               # batch eligibility + allocation (mirror of DB logic, used for preview/tests)
    payments.ts           # mixed-payment validation
    expiry.ts             # timezone-aware expiry rules
    ledger.ts             # balance derivation helpers (display)
  server/                 # server-only (`import "server-only"`)
    db/                   # typed query functions (one module per aggregate)
    actions/              # server actions: auth -> validate -> call RPC -> map errors
    services/             # integrations: sms, ocr, storage
    errors.ts             # DB/Supabase error -> user message + logging
  lib/
    supabase/{browser,server,admin}.ts
    validation/           # zod schemas (shared between client forms and server actions)
    utils/
  types/                  # generated DB types + hand-written DTOs
supabase/
  migrations/             # SQL, forward-only, timestamped
  functions/              # Edge Functions (sms-send, ocr-extract, ...)
  tests/                  # pgTAP / SQL tests (RLS, RPCs)
docs/
```

Rules:
- `domain/` imports nothing from React, Next or Supabase.
- `server/` is the only place that may import the admin client; enforced with
  `import "server-only"` and an ESLint restricted-import rule.
- Components call server actions or read through server components; they never build
  SQL or call RPC for money-affecting operations directly with the browser client.

## 3. Request flow (example: complete sale)

```
POS UI ──(cart: medicine_id, qty, discount, payments, customer_id, client_request_id)──▶
Server action completeSale
  1. session via Supabase SSR cookie client (never trust a user id from the client)
  2. zod-validate payload shape
  3. call RPC  public.complete_sale(payload)  using the USER's JWT
        ↳ inside Postgres, single transaction:
          auth.uid() → membership → has_permission('sale.create')
          lock candidate batches (FOR UPDATE, FEFO order)
          price/discount/tax/total computed in SQL
          validate payments = total (credit needs customer)
          insert sale, sale_items, sale_item_allocations (batch, qty, unit_cost snapshot)
          insert payments, stock_movements, update batches.quantity
          insert customer_ledger_entries (if credit/due)
          insert audit_log
          return invoice JSON
  4. map error codes → user message, log technical detail
  5. revalidate affected paths / return invoice
```
The RPC runs as `SECURITY DEFINER` with a pinned `search_path`, derives the actor
from `auth.uid()`, and checks permissions itself. Direct `INSERT/UPDATE/DELETE` on
stock, ledger and audit tables is revoked from `authenticated`.

## 4. Idempotency

`complete_sale`, `receive_payment`, `create_purchase` etc. take a
`client_request_id` (UUID) with a unique index per branch. A retry (network drop,
offline replay, double click) returns the original result instead of duplicating.

## 5. Reads, scale, performance

- Server-side pagination (keyset where lists are large: stock movements, sales),
  server-side filter/sort, indexes per `DATABASE.md`.
- Medicine search: `pg_trgm` GIN on name/generic/brand + btree on barcode/sku;
  RPC `search_medicines(q, limit)` returns stock summary in one query. Debounced
  (200–250 ms) client side, abortable.
- Dashboard/report aggregates via SQL functions/views, never client aggregation.
  If needed later: materialised daily summaries refreshed by sale/purchase
  transactions or scheduled job.
- Stock on hand per medicine = `sum(medicine_batches.quantity)` (indexed on
  `medicine_id`); reconciled against `stock_movements` by a check view.

## 6. Errors

`server/errors.ts` maps Postgres `SQLSTATE`/custom `RAISE` codes
(e.g. `PH001 insufficient_stock`, `PH002 batch_expired`, `PH003 payment_mismatch`,
`42501` permission) to stable app error codes and human messages (EN, Bangla-ready).
Unknown errors → generic message + correlation id; full detail to server logs.
Server actions return a discriminated union `{ok:true,data} | {ok:false,code,message}`.

## 7. Auth and session

Supabase Auth (email+password; phone OTP considered later). `@supabase/ssr` cookie
session. `proxy.ts` refreshes the session and redirects unauthenticated users;
**authorisation is not in the proxy** — it is in RLS/RPC. Server components
re-verify with `supabase.auth.getUser()` (not `getSession()`).

## 8. Multi-branch

Every business row carries `branch_id`. `branch_members(user_id, branch_id, role)`.
RLS predicate: `branch_id in (select branch_id from my_branches())`. One default
branch is seeded; UI shows a branch switcher only when the user has >1 branch.

## 9. Integrations

- **SMS**: Edge Function `sms-send` (provider adapter; queue table `sms_outbox`
  with status/retries; delivery log). Triggered by server actions or a scheduled
  reminder job. Provider choice (e.g. a Bangladesh gateway) is an open item.
- **OCR**: upload to private Storage bucket → Edge Function `ocr-extract` →
  writes `ocr_documents` + `ocr_lines` in status `REVIEW`. Confirmation calls the
  normal `create_purchase` RPC. Provider open item (cloud vision vs. other).
- **Storage**: private buckets (`invoices`, `medicine-images` public-read optional);
  signed URLs.

## 10. Offline / PWA (Phase 15)

- Web manifest + service worker (app shell + static assets cache).
- IndexedDB cache of the medicine catalogue (without trusted stock) for lookup.
- Offline sales go to an outbox with `client_request_id`; on reconnect each is
  submitted to `complete_sale`. The server revalidates stock/expiry/prices; rejects
  are surfaced for human resolution. Offline mode never decrements authoritative
  stock locally and never prints a final invoice number from the client (invoice
  numbers are allocated by the server; offline receipts are marked "PENDING").
- Open question: policy for selling when stock is unknown offline (default:
  allow with explicit "unverified" flag, reject on conflict).

## 11. Testing strategy

| Level | Tooling | Covers |
|---|---|---|
| Domain unit | Vitest | money, FEFO preview, payment split, expiry |
| Database | SQL/pgTAP against a real Postgres + Supabase auth schema stub | RPCs, FEFO, atomicity, ledger, returns, RLS |
| Server actions | Vitest with DB | auth → RPC → error mapping |
| E2E | Playwright (Chromium preinstalled) | POS, purchase, return, permissions |

**Environment constraint:** the build sandbox has no Docker daemon and blocks
Supabase/shadcn hosts, so `supabase start` is unavailable. Decision (implemented
in Phase 1): database tests run against a locally installed PostgreSQL 16 with a
minimal test-only `auth` stub — `scripts/db-test.sh`. CI should run the same
script against a service container, and migrations must still be tried on a real
Supabase branch/scratch project before production.

## 12. Deployment

Vercel for Next.js; Supabase project for DB/Auth/Storage/Functions; migrations
applied through the Supabase CLI (never edited after merge). Environments:
local → preview (Supabase branch or separate project) → production. Env vars in
Vercel; only `NEXT_PUBLIC_SUPABASE_URL` and the publishable (anon) key are public.
