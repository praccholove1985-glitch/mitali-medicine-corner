# UI System

Premium pharmacy SaaS: clean, fast, dense where useful, large touch targets in POS.
Subtle borders/shadows, strong hierarchy, no heavy gradients or glass effects.

## 1. Tokens

Defined once as CSS variables (Tailwind 4 `@theme` in `src/app/globals.css`);
components reference tokens, never raw hex.

| Token | Value | Use |
|---|---|---|
| `--primary` | `#2563EB` | primary actions, active nav, focus |
| `--accent` | `#38BDF8` | secondary highlights, charts |
| `--background` | `#F8FAFC` | app background |
| `--card` | `#FFFFFF` | surfaces |
| `--success` | `#16A34A` | paid, in stock |
| `--warning` | `#F59E0B` | expiring soon, low stock |
| `--danger` | `#DC2626` | expired, due, destructive |
| `--foreground` | `#0F172A` | text |
| `--muted-foreground` | `#64748B` | secondary text |

Contrast: verify each text/background pair ≥ 4.5:1 (note: `#F59E0B` and `#38BDF8`
fail on white as text — use them for fills/borders/icons with dark text, not as
text colour). Dark theme is deferred; tokens are structured so it can be added.
Status is always **icon + text + colour**, never colour alone.

Typography: system/Inter-class sans with Bangla fallback (Noto Sans Bengali);
tabular numerals for money columns; money formatted `৳1,234.50` through one
formatter in `domain/money.ts`.
Spacing 4 px grid; radius 8 px default (`--radius`); shadows `sm` only.

## 2. Layout

- Desktop: left sidebar (collapsible), topbar (branch, global search, shift/user
  menu, online/offline indicator), content with page header + actions.
- Tablet: collapsed icon sidebar.
- Mobile: top bar + drawer navigation; tables become card lists.
- POS: dedicated full-bleed layout (no sidebar by default), two panes
  (catalogue/search | cart & payment) on ≥ md; stacked with sticky pay bar on mobile.
  Min touch target 44×44 px; keyboard shortcuts (F2 search, F4 pay, Esc cancel,
  Enter add) listed in a help dialog.

## 3. Components

shadcn/ui primitives (Button, Input, Select, Dialog, Sheet, Table, Tabs, Toast,
Command, Badge, Skeleton, DropdownMenu, Form) plus app components:
`DataTable` (server-driven pagination/sort/filter, empty/loading/error),
`MoneyText`, `StatusBadge`, `ExpiryBadge` (OK / ≤90 d warning / expired),
`StockBadge`, `PageHeader`, `ConfirmDialog`, `EmptyState`, `ErrorState`,
`DateRangePicker` (today/yesterday/7d/30d/month/custom), `MedicineSearch`
(debounced, keyboard navigable, barcode-aware), `PaymentSplitEditor`.

## 4. State handling (mandatory per async surface)

Loading (skeleton, not spinner-only) · success (toast + state change) · error
(message from error map, retry) · empty (explains and offers the next action).
Forms: labelled, inline field errors, disabled-while-submitting, double-submit
safe (idempotency key generated per attempt).

## 5. Accessibility

Full keyboard operation of POS; visible `:focus-visible` ring (primary); dialogs via
Radix (focus trap, Esc, labelled); `aria-live` for cart total/toasts; table
semantics; form labels/`aria-describedby` for errors; reduced-motion respected;
touch and pointer parity; target WCAG 2.2 AA. Automated axe check in E2E.

## 6. Performance

Server components by default; client components only for interactive islands (POS,
tables with local UI state). No full-table loads; virtualised lists only where a
page may exceed ~200 rendered rows. Debounce 200–250 ms with request abort.

## 7. Implementation status (Phase 2)

Built and verified: tokens (light + dark, `data-theme` set by a pre-paint script,
choice kept in `localStorage`), app shell (desktop sidebar, 64px tablet icon rail,
phone drawer, sticky topbar, skip link), Button/Card/Input/Select/Textarea/Field/
Badge/Alert/Skeleton/Table/Dialog/Sheet, and the app components PageHeader,
StatCard, EmptyState, ErrorState, LoadingState/TableSkeleton, StatusBadge,
ExpiryBadge, StockBadge, MoneyText (`domain/money.ts`) and DataTable.
Route error boundary, loading UI and 404 exist. `/design-system` shows everything
(development only; 404 in production).

Notes:
- **shadcn/ui CLI was blocked** (`ui.shadcn.com` 403), so the primitives are written
  by hand in the shadcn style on `radix-ui`, `class-variance-authority` and
  `tailwind-merge`. Running the CLI later may overwrite these files; review diffs.
- Contrast: every token pair is checked by script (text pairs 4.5:1, focus ring and
  input borders 3:1) in both themes. The input border is darker than the usual
  shadcn default so form fields meet 3:1.
- `ExpiryBadge` takes `daysToExpiry` from the server; the browser never decides
  expiry. `StockBadge` takes the medicine's own reorder level.
- Dashboard cards show "Not connected" with the phase that fills them; no figure is
  displayed without a data source. The topbar search is disabled until Phase 3 and
  the user box reads "Not signed in" until Phase 1.
- Deferred: permission-aware navigation (Phase 1/14), branch switcher, command
  palette, virtualised lists.

## 8. Verification

Each UI phase: measure in Chromium via Playwright at 1440, 1024, 768 and 390 px
widths with reduced motion; check keyboard-only path; record screenshots in PR.
(Sandbox note: Supabase hosts are blocked, so UI is verified against a local/stubbed
data layer; real-data verification happens in preview deployments.)
