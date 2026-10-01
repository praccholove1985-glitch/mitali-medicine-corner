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
