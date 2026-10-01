# Security

## 1. Threat model (short)

Actors: authenticated staff with limited roles (main risk: privilege abuse, data
tampering, fraud), unauthenticated internet users, leaked browser bundle/keys,
compromised provider keys (SMS/OCR).
Assets: stock and financial integrity, customer personal data (names, phones,
purchase history/medicines), audit trail, provider credentials.

## 2. Secrets

| Secret | Where it lives | Never |
|---|---|---|
| Supabase service-role key | Vercel server env / Edge Function secrets | in `NEXT_PUBLIC_*`, client code, git |
| SMS gateway credentials | Edge Function secrets | browser, Next client bundle |
| OCR provider key | Edge Function secrets | browser |
| `NEXT_PUBLIC_SUPABASE_URL`, publishable key | public by design | — (RLS protects data) |

`.env*` is git-ignored; `.env.example` lists names only. `src/lib/supabase/admin.ts`
starts with `import "server-only"`. CI runs a secret scan before merge.

## 3. Authentication

Supabase Auth; HTTP-only cookie session via `@supabase/ssr`. Server code uses
`auth.getUser()` (validates with Auth server), never trusts `getSession()` alone.
Disabled staff (`profiles.is_active=false` / membership inactive) lose access
immediately because RLS/RPC check membership on every call, not only token claims.
Password policy and rate limits per Supabase Auth settings; MFA for ADMIN
recommended.

## 4. Authorisation (defence in depth)

1. **RLS on every table** (default deny). Policies are keyed on membership:
   `branch_id in (select branch_id from branch_members where user_id = auth.uid() and is_active)`.
2. **Permissions** are `resource.action` strings (e.g. `sale.create`,
   `sale.return`, `purchase.create`, `stock.adjust`, `price.edit`,
   `finance.view_profit`, `staff.manage`, `settings.edit`, `audit.view`).
   `has_permission(branch, perm)` = role bundle ± user override, `SECURITY DEFINER`,
   stable.
3. **Writes to critical tables only via RPC.** `INSERT/UPDATE/DELETE` revoked from
   `authenticated` on stock, ledgers, payments, sales, audit; RPCs enforce
   permission and invariants.
4. **UI hiding is cosmetic.** Menus/buttons reflect permissions for UX only.
5. Cost, profit and supplier price columns are exposed to roles with
   `finance.view_profit` / `purchase.view_cost` through views/RPC; base tables are
   not selectable by CASHIER/STAFF.

Role bundles (initial; editable by ADMIN, changes audited):

| Permission area | ADMIN | MANAGER | PHARMACIST | CASHIER | STAFF |
|---|---|---|---|---|---|
| Sell / quick sale | ✓ | ✓ | ✓ | ✓ | – |
| Discount above limit | ✓ | ✓ | limit | – | – |
| Sales return | ✓ | ✓ | ✓ | request only | – |
| Medicines/batches edit | ✓ | ✓ | ✓ | – | – |
| Price edit | ✓ | ✓ | – | – | – |
| Stock adjust / damage | ✓ | ✓ | ✓ | – | count only |
| Purchases / returns | ✓ | ✓ | – | – | – |
| Customer payments | ✓ | ✓ | ✓ | ✓ | – |
| Expenses | ✓ | ✓ | – | – | – |
| View profit/cost | ✓ | ✓ | – | – | – |
| Reports | ✓ | ✓ | limited | own sales | – |
| Staff/permissions/settings | ✓ | – | – | – | – |
| Audit log | ✓ | view | – | – | – |

## 5. Integrity controls

- Append-only triggers on `stock_movements`, ledgers, `audit_log`.
- `check (quantity >= 0)`, idempotency keys, deterministic locking.
- Server recomputes every total, cost and balance.
- Sales/purchase documents immutable; corrections via returns/adjustments.
- Back-dating restricted by permission and audited.

## 6. Audit

`audit_log` written inside the same transaction as the change (RPCs and triggers on
medicines/prices/settings/permissions), with actor, entity, old/new JSON. Not
editable through the API; viewable by permission.

## 7. Input, output, web

- zod validation on every server action; SQL parameterised (no string-built SQL;
  `search_medicines` uses bound parameters and escapes `like` wildcards).
- Security headers + CSP via Next config/proxy (see Next.js CSP guide), `frame-ancestors 'none'`.
- Server actions: CSRF protected by Next defaults; additionally verify origin.
- Storage: private buckets, signed URLs, MIME/size limits, malware-scan hook open item.
- Rate limiting on auth and expensive endpoints (OCR, SMS) — Vercel/Edge level.
- Errors: no raw DB messages to users; correlation id, logs server-side. No PII in logs.

## 8. Privacy

Customer data and dispensing history are sensitive. Collect minimum; role-limited
access; export restricted to permitted roles; retention policy open item. SMS
content avoids medicine names by default.

## 9. Testing security

- RLS tests: per role, per table, per branch (cross-branch read/write denied;
  CASHIER cannot read cost; direct table writes denied; RPC without permission
  denied).
- Negative tests for service-role leakage (bundle grep in CI for `service_role`).
- Dependency audit in CI.

## 10. Open items

MFA enforcement, retention policy, breach-notification contact, backup/restore
drill schedule (Supabase PITR availability depends on plan).

## 11. As built — Phase 1

- Sign-in is email + password through Supabase Auth; the session lives in an
  HTTP-only cookie managed by `@supabase/ssr`. Sign-up is not exposed in the UI;
  accounts are created by an administrator in Supabase Auth.
- `src/proxy.ts` refreshes the session and keeps signed-out visitors off app pages.
  It is an optimistic gate only. The (app) layout re-checks the session on the
  server with `auth.getUser()` (validated by the Auth server, not a cookie decode)
  and the database enforces permissions.
- A signed-in user with no active branch membership sees a "no access" screen;
  the database returns them no rows.
- Navigation, dashboard cards and shortcuts are filtered by permission. This is
  cosmetic; the database is the control. Cost/profit cards are not drawn for roles
  without `finance.view_profit` / `purchase.view_cost`.
- Wrong password and unknown email produce the same message. Post-login redirects
  accept same-site paths only (`safeNextPath`, tested against `//host`, schemes,
  control characters).
- Database and Auth errors are mapped to safe messages (`server/errors.ts`); the
  log line carries a reference id, code and truncated message, never row values.
- Baseline headers: `X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Permissions-Policy` (camera allowed for barcode scanning).
  A CSP needs a nonce for the theme script and is scheduled for Phase 16.
- The app reads only `NEXT_PUBLIC_SUPABASE_URL` and the publishable key. No service
  role key is read anywhere in the codebase yet.
- Not yet exercised against a live Supabase project: sign-in, cookie refresh and
  the session queries. The database side is tested locally; the Auth/PostgREST
  wiring needs a real project to confirm.

## 12. As built — Phase 3

- Cost never leaves through a table read: cost columns are excluded from
  `authenticated`'s column privileges (guard test), and only functions that check
  `purchase.view_cost` return them. The UI also omits the cost column and purchase-price
  field for roles without it.
- Medicine, batch and movement tables accept no direct writes; every change is a
  function that checks the permission itself, rejects unknown fields, and is audited.
- Price edits are a separate permission from catalogue edits; a pharmacist can fix a
  medicine's details but cannot set or change prices.
- Stock can't drift: the commit-time invariant means no bug in a later RPC can leave a
  batch quantity unexplained by movements.
- Search treats input as plain text (LIKE wildcards escaped; parameters bound).
- Server actions re-validate with zod (the same schemas as the forms), build the RPC
  payload from the validated values only, and map every database error to a safe
  message; unique-violation text is inspected only to pick the field to highlight.
- Not yet exercised against a live Supabase project (see Phase 1 caveats).

## 13. As built — Phase 4

- Stock can only be changed by `adjust_stock` and `write_off_expired`, which check
  `stock.adjust` in the batch's own branch, lock the batch, and write the movement and the
  new quantity together. Cross-branch attempts fail with a permission error.
- Every manual change carries a reason, the actor and a timestamp, can't be edited or
  deleted, and is also audited on the batch (old and new quantity).
- Cost value is hidden from roles without `purchase.view_cost` in every inventory read
  (the column is null, and the UI omits the column and the value card).
- Retried form submits are idempotent: the server generates the request id when it
  renders the dialog, so a double click or resubmit adjusts once.
- A reconciliation check, restricted to `audit.view`, detects any drift between batch
  quantities and their movements.

## 14. As built — Phase 5

- `complete_sale` re-prices, re-allocates and locks stock server-side; the browser sends
  only medicine ids, quantities, an optional batch choice, discount and payment amounts.
- Sales, items, allocations, payments and ledger rows accept no direct writes and are
  immutable; cost and profit columns are not selectable by `authenticated`.
- Cashiers see only their own sales unless they hold `sale.view_all`; invoices carry no cost.
- `/api/pos/*` handlers return JSON 401/503 rather than redirects and re-check the session.
- Not yet exercised against a live Supabase project.
