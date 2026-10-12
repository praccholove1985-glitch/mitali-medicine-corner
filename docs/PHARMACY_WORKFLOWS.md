# Pharmacy Workflows

Business rules chosen where the brief was silent are tagged **[RULE]** and need
owner confirmation. APK-derived flows: **[APK-PENDING]** (APK unavailable).

## 1. Receive stock (purchase)
1. Select supplier, enter supplier invoice no. and date (duplicate supplier+invoice blocked).
2. Add lines: medicine, batch no., expiry, qty, free qty, cost, discount, VAT.
3. Effective unit cost = line total ÷ (qty + free qty). Batch created, or an existing
   identical batch (medicine+supplier+batch+expiry) topped up.
4. Payment now (any methods) and/or left as supplier due.
5. Result: purchase, batches, `PURCHASE` movements, supplier ledger entries, audit.
**[RULE]** Expiry earlier than today is rejected; expiry within 90 days warns.

## 1a. Opening stock (as built, Phase 3)
Add a medicine to the catalogue, then add its batches from the medicine page: batch
number, expiry (must be after today in the branch timezone), quantity on hand, cost,
sale price, MRP. Each batch becomes a separate row with its own cost; an OPENING_STOCK
movement records the quantity and who entered it. Prices need `price.edit` to change
afterwards; cost is never edited.

## 1b. Stock adjustment and expiry (as built, Phase 4)
From a medicine's batch list, anyone with `stock.adjust` can record: a count that
differs from the system (up or down), a correction of an earlier mistake, damage or
loss (down only), or expiry (down only, and only once the batch has expired). A reason
is required and the history keeps who did it. The dialog shows the resulting total and
refuses to go below zero. Expired stock is listed on the Expiry tab (expired, then
30/60/90-day windows); "Write off" takes the expired batches on the page out of stock in
one step, keeping the batches and their history. Low stock is any medicine with a reorder
level whose sellable stock (unexpired only) is at or below it.

## 1b-2. Receive stock (as built, Phase 7)
1. Purchases > New purchase: choose the supplier, enter the supplier's invoice number and date.
2. Add a line per batch: medicine, batch number, expiry, units bought, free units, price per unit,
   optional discount (percent or amount) and VAT %. A new batch can carry its own sale price and MRP;
   otherwise the medicine's defaults are used, and a medicine with no default price needs one.
3. The totals shown come from the server as you type: gross = units x price, rounded once to 2
   decimals; discount comes off that; **[RULE]** VAT is added on top (supplier prices are VAT-exclusive).
4. **Cost per unit** = line total / (bought + free units). Free units lower it.
5. The same medicine + supplier + batch number + expiry is one batch: the purchase tops it up and the
   batch cost becomes the average over the units on hand. Prices are never changed by a purchase.
6. Pay now with any money methods (or nothing); what is not paid stays owed. You can't pay more than
   the total, and credit is not a payment method here.
7. Rules: expired or expiring-today stock is refused; the supplier's invoice number can't be entered
   twice; the invoice date can't be in the future. Everything is recorded together or not at all.
8. Pay a supplier later from their page; a payment can't exceed what is owed. The supplier page has a
   statement for any date range.
Purchases, their lines and the ledger can't be edited; mistakes are corrected by returns (Phase 8) or
adjustments.

## 2. Sell (POS / Quick Sale)
1. Search/scan → add to cart. Default batch = FEFO; show expiry.
2. Edit qty, discount (limit by role), see totals (preview only).
3. Choose customer (walk-in or registered).
4. Payment: single, mixed, or credit. Components must equal total; credit requires
   a registered customer (and respects optional credit limit).
5. Complete → one RPC (see ARCHITECTURE §3). Failure leaves nothing partial.
6. Invoice printed/shared. Invoice number comes from the server.
**FEFO**: earliest expiry among batches with stock and expiry > today (Asia/Dhaka).
A line larger than the first batch splits across batches; each part keeps its own
cost. Expired stock is never sold; it must be written off (see §7).
**Rx-required [RULE]**: the sale requires PHARMACIST/MANAGER/ADMIN, or a cashier
sale must record who authorised; recorded in audit. Prescription capture beyond a
flag is out of v1.
**Price [RULE]**: unit price defaults to batch sale price, else medicine default;
selling above MRP is blocked; below cost needs permission.

### 2a. As built (Phase 5)
- Prices come only from the batch the server allocates; the browser never sends a price.
  The cart shows a server quote (`quote_sale`) and the sale uses the same function.
- Line gross is rounded once (half-up, 2 dp); discount comes off the gross; **[RULE]**
  prices include VAT, so tax = net × rate ÷ (100 + rate).
- **[RULE]** Discount limit is the branch `max_discount_percent` (default 5) unless the
  user has `sale.discount`; selling below batch cost also needs `sale.discount`.
- **[RULE]** Prescription medicines need `sale.dispense_rx` (admin, manager, pharmacist).
- Payments (cash, bKash, Nagad, Rocket, card, bank, credit) must add up to the total
  exactly; credit needs a registered customer and creates a `SALE_DUE` ledger entry.
- A retried submit with the same request id returns the original invoice.

## 3. Customer due and payment
Credit portion creates a `SALE_DUE` ledger entry. Later payments create `PAYMENT`
entries (allocation to oldest due first is informational; balance is the sum).
Statement = ledger entries in a date range with opening/closing balance.
SMS reminder uses the server-computed balance.

### 3a. As built (Phase 6)
- A customer's balance is the sum of their ledger. Positive = they owe; negative = they hold an
  advance. Nothing types a balance in: sales on credit add to it, payments subtract.
- **Receive payment**: pick how they paid and the amount (or "Pay all"); optional transaction id and
  note. One call records the money and the ledger entry together, retried clicks record once.
- **[RULE]** A payment can't be more than what is due. A customer who owes nothing can't "pay"; an
  advance deposit is not part of v1.
- Payments are allocated by balance, not to particular sales. Aging by sale is not shown.
- **[RULE]** Deactivating a customer hides them from the till only; they stay in the list under
  Inactive, keep their history, and can still pay what they owe.
- **Statement**: choose a date range (branch timezone). It shows the balance brought forward, each
  charge and payment with the balance after it, and the closing balance, and can be printed.
  Ranges over 1,000 entries are shortened; the balances stay complete.

## 4. Sales return
1. Find original sale; pick items and quantities (≤ sold − already returned).
2. Server restores stock to the **original allocation batches**, reverses revenue,
   COGS and profit using the snapshotted cost, refunds cash/method or credits the
   customer ledger (`RETURN_CREDIT`).
3. **[RULE]** If the original batch has since expired, stock is restored then
   immediately moved out as `EXPIRED` (not sellable); a pharmacist may mark
   "return to shelf" only if the batch is still unexpired.
4. Original sale is untouched. Audit row written.

## 5. Purchase return
Select purchase lines/batches and quantity (≤ batch quantity on hand and ≤ received).
Reduces the batch (`PURCHASE_RETURN` movement), credits the supplier ledger
(`RETURN_CREDIT`) or records a refund. Original purchase untouched.

## 6. Stock adjustment
Types: ADJUSTMENT (count correction), DAMAGE, EXPIRED, CORRECTION, OPENING_STOCK.
Reason is mandatory; permission `stock.adjust`; reduces below zero impossible.
Every adjustment is a movement + audit. Stocktake mode (Phase 4) compares counted
vs system per batch and proposes adjustments for approval.

## 7. Expiry management
Buckets: expired, ≤30 d, ≤60 d, ≤90 d (configurable). Expired stock listing with
one-action write-off (`EXPIRED` movements) or supplier return. Dashboard shows
count and value at risk. Expiry rule is date-based in branch timezone: expiring
**today = expired**.

## 8. Low stock / reorder
Low when on-hand (sum of unexpired batches) ≤ `reorder_level`; "out" at 0.
**[RULE]** Expired stock does not count toward available quantity. Suggested
reorder list per supplier.

## 9. OCR purchase invoice
Upload → status `PROCESSING` → `REVIEW` (extracted header + lines with confidence).
Reviewer fixes lines, resolves matches (barcode → exact name → SKU → generic+strength
→ fuzzy; no match → *Create medicine / Select existing / Ignore*), then **Confirm**,
which calls the normal purchase RPC. Rejecting keeps the document for audit.
Nothing is committed before confirmation.

## 10. Cash and payment methods
Cash, bKash, Nagad, Rocket, Card, Bank, Credit. Daily summary by method.
Reference/transaction id optional on mobile-banking methods.
**[RULE]** Shift open/close (cash drawer count) is Phase 9 optional.

## 11. Edge cases to cover in tests
Two cashiers selling the last units simultaneously · same batch number from two
suppliers · free quantity cost · batch expiring today · line spanning 3 batches ·
payment mismatch by 1 paisa · duplicate submit/retry · return of a partly-returned
sale · return after price change · supplier price change vs historic profit ·
back-dated entries.

## 12. [APK-PENDING]
Navigation, screens and workflows of the reference app are not yet analysed. Once
the file is provided, add a comparison table here (feature, reference behaviour,
our decision) — functional/UX reference only; no code or asset reuse.
