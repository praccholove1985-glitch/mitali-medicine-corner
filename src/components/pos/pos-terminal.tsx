"use client";

import { useEffect, useId, useReducer, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Minus, PackageX, Plus, ScanBarcode, Search, ShoppingCart, Trash2, X } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { MoneyText } from "@/components/common/money-text";
import { BatchPickerDialog } from "@/components/pos/batch-picker-dialog";
import { CustomerDialog } from "@/components/pos/customer-dialog";
import { SaveCartDialog, SavedCartsDialog } from "@/components/pos/drafts-dialog";
import { DiscountDialog } from "@/components/pos/discount-dialog";
import { useProductSearch, useQuote } from "@/components/pos/hooks";
import { PaymentDialog } from "@/components/pos/payment-dialog";
import { formatDate } from "@/lib/dates";
import { cartReducer, linesFromDraft, toApiItems, totalUnits, type CartLine } from "@/lib/pos/cart";
import { cn } from "@/lib/utils";
import type { PosCustomer, PosMedicine } from "@/server/db/pos";
import type { ActionFailure, CompleteSaleResult, CustomerResult, DraftResult } from "@/app/(app)/pos/actions";

export type PosActions = {
  completeSale: (input: unknown) => Promise<CompleteSaleResult>;
  saveDraft: (input: unknown) => Promise<DraftResult>;
  deleteDraft: (id: string) => Promise<{ ok: true } | ActionFailure>;
  saveCustomer: (input: unknown) => Promise<CustomerResult>;
};

type Props = {
  actions: PosActions;
  /** Customer search needs customer.view; without it the till sells to walk-ins only. */
  canPickCustomer: boolean;
  /** Where to go after a sale. Defaults to the invoice page. */
  onSaleComplete?: (sale: { saleId: string; invoiceNo: string }) => void;
};

export function PosTerminal({ actions, canPickCustomer, onSaleComplete }: Props) {
  const router = useRouter();
  const searchId = useId();
  const listId = `${searchId}-results`;
  const searchRef = useRef<HTMLInputElement>(null);

  const [lines, dispatch] = useReducer(cartReducer, [] as CartLine[]);
  const [customer, setCustomer] = useState<PosCustomer | null>(null);
  const [draftId, setDraftId] = useState<string | undefined>(undefined);
  const [draftName, setDraftName] = useState("");
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [announce, setAnnounce] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [payKey, setPayKey] = useState(0);
  const [saleError, setSaleError] = useState<ActionFailure | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // One id per attempt at taking payment: retrying the same attempt cannot sell twice.
  const requestId = useRef<string | null>(null);

  const quote = useQuote(lines);
  const { state: search, searchNow } = useProductSearch(query);

  const ready = quote.status === "ready";
  const grandTotal = ready ? quote.quote.totals.grandTotal : null;
  const canPay = ready && lines.length > 0;

  // F2 jumps to search; F4 takes payment.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "F2") {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (event.key === "F4" && canPay) {
        event.preventDefault();
        openPayment();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canPay]);

  function addMedicine(m: PosMedicine) {
    if (m.sellableQty <= 0) {
      setAnnounce(`${m.name} is out of stock.`);
      return;
    }
    dispatch({
      type: "add",
      key: crypto.randomUUID(),
      medicine: { id: m.id, name: m.name, strength: m.strength, unit: m.unit, prescriptionRequired: m.prescriptionRequired },
    });
    setAnnounce(`Added ${m.name}.`);
    setSaleError(null);
    setQuery("");
    setActive(0);
    searchRef.current?.focus();
  }

  async function onSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(search.items.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === "Escape") {
      setQuery("");
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (query.trim() === "") return;
      // A scanner types the code and presses Enter before the debounce fires: ask now.
      const items = search.status === "ready" ? search.items : await searchNow();
      const exact = items.find((i) => i.exactMatch);
      const chosen = exact ?? items[Math.min(active, items.length - 1)];
      if (chosen) addMedicine(chosen);
      else setAnnounce("No medicine found.");
    }
  }

  function openPayment() {
    requestId.current = crypto.randomUUID();
    setPayKey((k) => k + 1);
    setPayError(null);
    setSaleError(null);
    setPayOpen(true);
  }

  function confirmPayment(payments: Array<{ method: string; amount: string; reference?: string }>) {
    setPayError(null);
    startTransition(async () => {
      const result = await actions.completeSale({
        clientRequestId: requestId.current ?? crypto.randomUUID(),
        customerId: customer?.id ?? null,
        items: toApiItems(lines),
        payments,
      });
      if (result.ok) {
        if (draftId) void actions.deleteDraft(draftId);
        dispatch({ type: "clear" });
        setCustomer(null);
        setDraftId(undefined);
        setDraftName("");
        setPayOpen(false);
        if (onSaleComplete) onSaleComplete(result);
        else router.push(`/pos/invoices/${result.saleId}?new=1`);
        return;
      }
      if (result.line !== undefined) {
        // The database named a line (stock, batch, discount, prescription): back to the cart.
        setPayOpen(false);
        setSaleError(result);
      } else {
        setPayError(result.message);
      }
    });
  }

  const lineError = (index: number): string | null => {
    const failure = quote.status === "error" ? quote.failure : saleError;
    const hint = failure && "hint" in failure ? failure.hint : null;
    const line = hint && typeof hint === "object" ? (hint as { line?: unknown }).line : undefined;
    if (typeof line !== "number" || line !== index + 1) return null;
    const available = (hint as { available?: unknown }).available;
    const base = failure?.message ?? "";
    return typeof available === "number" ? `${base} Only ${available} can be sold.` : base;
  };

  const generalError =
    saleError && saleError.line === undefined
      ? saleError.message
      : quote.status === "error" && !((quote.failure.hint as { line?: unknown } | null)?.line)
        ? quote.failure.message
        : null;

  const totals = ready ? quote.quote.totals : null;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      {/* ---------- Search ---------- */}
      <section aria-label="Find medicines" className="min-w-0">
        <div className="relative">
          <ScanBarcode className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            ref={searchRef}
            role="combobox"
            aria-expanded={query.trim() !== ""}
            aria-controls={listId}
            aria-activedescendant={search.items[active] ? `${searchId}-opt-${active}` : undefined}
            aria-label="Search by name, generic, brand, company, barcode or SKU. Scan a barcode and press Enter to add."
            placeholder="Scan a barcode or type a medicine name"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onSearchKeyDown}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            className="h-14 pr-24 pl-12 text-base"
          />
          <span className="pointer-events-none absolute top-1/2 right-4 hidden -translate-y-1/2 text-xs text-muted-foreground sm:block">F2</span>
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                searchRef.current?.focus();
              }}
              className="absolute top-1/2 right-4 flex size-8 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-muted sm:right-10"
            >
              <X className="size-4" aria-hidden />
              <span className="sr-only">Clear search</span>
            </button>
          ) : null}
        </div>

        <p className="sr-only" role="status" aria-live="polite">
          {announce}
        </p>

        <div className="mt-3">
          {query.trim() === "" ? (
            <Card>
              <EmptyState
                icon={Search}
                title="Ready to sell"
                description="Scan a barcode, or type part of a name, generic, brand, company or SKU. Press Enter to add the top result."
              />
            </Card>
          ) : search.status === "error" ? (
            <Alert tone="danger" title="Search failed">
              {search.message}
            </Alert>
          ) : (
            <ul id={listId} role="listbox" aria-label="Search results" className="flex flex-col gap-2">
              {search.status === "loading" && search.items.length === 0
                ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-[4.5rem]" />)
                : null}
              {search.items.map((m, index) => {
                const out = m.sellableQty <= 0;
                return (
                  <li
                    key={m.id}
                    id={`${searchId}-opt-${index}`}
                    role="option"
                    aria-selected={index === active}
                    aria-disabled={out}
                  >
                    <button
                      type="button"
                      onClick={() => addMedicine(m)}
                      onMouseEnter={() => setActive(index)}
                      disabled={out}
                      className={cn(
                        "flex min-h-[4.5rem] w-full items-center justify-between gap-4 rounded-xl border bg-card px-4 py-3 text-left transition-colors",
                        index === active && !out && "border-primary bg-primary-soft/50",
                        out ? "cursor-not-allowed opacity-60" : "hover:border-primary",
                      )}
                    >
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-base font-semibold">{m.name}</span>
                          {m.strength ? <span className="text-sm text-muted-foreground">{m.strength}</span> : null}
                          {m.prescriptionRequired ? <Badge tone="info">Rx</Badge> : null}
                          {m.exactMatch ? <Badge tone="primary">Barcode match</Badge> : null}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {[m.genericName, m.dosageForm, m.companyName].filter(Boolean).join(" · ") || "—"}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        {out ? (
                          <span className="inline-flex items-center gap-1 text-sm font-medium text-danger-text">
                            <PackageX className="size-4" aria-hidden />
                            Out of stock
                          </span>
                        ) : (
                          <>
                            {m.salePrice !== null ? (
                              <MoneyText amount={m.salePrice} fractionDigits={2} className="text-lg font-semibold" />
                            ) : (
                              <span className="text-sm text-muted-foreground">Price not set</span>
                            )}
                            <span className="flex items-center gap-2 text-xs text-muted-foreground">
                              <span className="tabular">{m.sellableQty} in stock</span>
                              {m.batchCount > 1 ? <span>{m.batchCount} batches</span> : null}
                            </span>
                            {m.nearestExpiry ? <span className="text-xs text-muted-foreground">Next expiry {formatDate(m.nearestExpiry)}</span> : null}
                          </>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
              {search.status === "ready" && search.items.length === 0 ? (
                <li className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                  Nothing matches “{query.trim()}”. Check the spelling, or try the generic name, company, barcode or SKU.
                </li>
              ) : null}
            </ul>
          )}
        </div>
      </section>

      {/* ---------- Cart ---------- */}
      <section aria-label="Cart" className="min-w-0">
        <Card className="lg:sticky lg:top-20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShoppingCart className="size-4" aria-hidden />
              Cart
              {lines.length > 0 ? <Badge tone="primary">{totalUnits(lines)} units</Badge> : null}
            </CardTitle>
            {lines.length > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  dispatch({ type: "clear" });
                  setSaleError(null);
                  setDraftId(undefined);
                }}
              >
                <Trash2 aria-hidden />
                Clear
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <CustomerDialog customer={customer} onSelect={setCustomer} saveCustomer={actions.saveCustomer} disabled={!canPickCustomer} />

            {generalError ? (
              <Alert tone="danger" title="This cart can't be sold yet">
                {generalError}
              </Alert>
            ) : null}

            {lines.length === 0 ? (
              <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                The cart is empty. Scan or search to add items.
              </p>
            ) : (
              <ul className="flex flex-col gap-3" aria-label="Items in the cart">
                {lines.map((line, index) => {
                  const priced = ready && quote.quote.lines.length === lines.length ? quote.quote.lines[index] : undefined;
                  const error = lineError(index);
                  const name = line.name ?? priced?.name ?? "Medicine";
                  const strength = line.strength ?? priced?.strength;
                  return (
                    <li key={line.key} className={cn("rounded-xl border p-3", error && "border-danger")}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-2 font-semibold">
                            <span>{name}</span>
                            {strength ? <span className="text-sm font-normal text-muted-foreground">{strength}</span> : null}
                            {line.prescriptionRequired || priced?.prescriptionRequired ? <Badge tone="info">Rx</Badge> : null}
                          </p>
                          {line.batchLabel ? <p className="text-xs text-muted-foreground">Batch {line.batchLabel}</p> : null}
                          {priced && priced.batches > 1 ? (
                            <p className="text-xs text-muted-foreground">Taken from {priced.batches} batches</p>
                          ) : null}
                        </div>
                        <div className="shrink-0 text-right">
                          {priced ? (
                            <>
                              <MoneyText amount={priced.lineTotal} fractionDigits={2} className="text-base font-semibold" />
                              {priced.discount !== "0" && Number(priced.discount) > 0 ? (
                                <p className="text-xs text-success-text">Saves ৳{priced.discount}</p>
                              ) : null}
                            </>
                          ) : (
                            <Skeleton className="h-6 w-16" />
                          )}
                        </div>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-1" role="group" aria-label={`Quantity of ${name}`}>
                          <Button variant="outline" size="icon" onClick={() => dispatch({ type: "increment", key: line.key, by: -1 })} disabled={line.quantity <= 1}>
                            <Minus aria-hidden />
                            <span className="sr-only">One fewer</span>
                          </Button>
                          <Input
                            inputMode="numeric"
                            aria-label={`Quantity of ${name}`}
                            value={line.quantity}
                            onChange={(e) => {
                              const n = Number.parseInt(e.target.value.replace(/\D/g, ""), 10);
                              dispatch({ type: "setQuantity", key: line.key, quantity: Number.isFinite(n) ? n : 1 });
                            }}
                            onFocus={(e) => e.currentTarget.select()}
                            className="h-10 w-16 px-1 text-center text-base font-semibold"
                          />
                          <Button variant="outline" size="icon" onClick={() => dispatch({ type: "increment", key: line.key, by: 1 })}>
                            <Plus aria-hidden />
                            <span className="sr-only">One more</span>
                          </Button>
                        </div>
                        <div className="flex items-center">
                          <BatchPickerDialog
                            medicineId={line.medicineId}
                            medicineName={name}
                            selectedBatchId={line.batchId}
                            onSelect={(b) => dispatch({ type: "setBatch", key: line.key, batchId: b?.id ?? null, batchLabel: b?.label })}
                          />
                          <DiscountDialog
                            lineId={line.key}
                            medicineName={name}
                            discountType={line.discountType}
                            discountValue={line.discountValue}
                            onApply={(type, value) => dispatch({ type: "setDiscount", key: line.key, discountType: type, discountValue: value })}
                          />
                          <Button variant="ghost" size="icon-sm" onClick={() => dispatch({ type: "remove", key: line.key })}>
                            <Trash2 aria-hidden />
                            <span className="sr-only">Remove {name}</span>
                          </Button>
                        </div>
                      </div>
                      {error ? (
                        <p role="alert" className="mt-2 text-sm font-medium text-danger-text">
                          {error}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}

            {lines.length > 0 ? (
              <dl className="flex flex-col gap-1 border-t pt-3 text-sm" aria-label="Totals">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Subtotal</dt>
                  <dd>{totals ? <MoneyText amount={totals.subtotal} fractionDigits={2} /> : <Skeleton className="h-4 w-16" />}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Discount</dt>
                  <dd>{totals ? <MoneyText amount={totals.discountTotal} fractionDigits={2} /> : <Skeleton className="h-4 w-16" />}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">VAT included</dt>
                  <dd>{totals ? <MoneyText amount={totals.taxTotal} fractionDigits={2} /> : <Skeleton className="h-4 w-16" />}</dd>
                </div>
                <div className="mt-1 flex items-baseline justify-between border-t pt-2">
                  <dt className="text-base font-semibold">Total</dt>
                  <dd aria-live="polite">
                    {totals ? (
                      <MoneyText amount={totals.grandTotal} fractionDigits={2} className="text-3xl font-semibold" />
                    ) : quote.status === "error" ? (
                      <span className="text-sm text-danger-text">Can&rsquo;t price</span>
                    ) : (
                      <Skeleton className="h-8 w-28" />
                    )}
                  </dd>
                </div>
              </dl>
            ) : null}

            <Button size="pos" disabled={!canPay || pending} onClick={openPayment} className="w-full">
              {canPay && grandTotal ? (
                <>
                  Take payment · <MoneyText amount={grandTotal} fractionDigits={2} />
                  <span className="ml-2 hidden text-xs opacity-80 sm:inline">F4</span>
                </>
              ) : (
                "Take payment"
              )}
            </Button>

            <div className="flex flex-wrap gap-2">
              <SaveCartDialog
                disabled={lines.length === 0}
                initialName={draftName}
                onSave={async (name) => {
                  const result = await actions.saveDraft({ id: draftId, name, customerId: customer?.id ?? null, items: toApiItems(lines) });
                  if (result.ok) {
                    setDraftId(result.id);
                    setDraftName(name);
                    setAnnounce("Cart saved.");
                  }
                  return result;
                }}
              />
              <SavedCartsDialog
                onDelete={async (id) => {
                  const result = await actions.deleteDraft(id);
                  if (result.ok && id === draftId) setDraftId(undefined);
                  return result;
                }}
                onResume={(d) => {
                  dispatch({ type: "load", lines: linesFromDraft(d.items, () => crypto.randomUUID()) });
                  setCustomer(
                    d.customerId ? { id: d.customerId, name: d.customerName ?? "Customer", phone: null, address: null, creditLimit: null, balance: "0" } : null,
                  );
                  setDraftId(d.id);
                  setDraftName(d.name ?? "");
                  setSaleError(null);
                  setAnnounce("Saved cart resumed.");
                }}
              />
            </div>
          </CardContent>
        </Card>
      </section>

      {payOpen && grandTotal ? (
        <PaymentDialog
          key={payKey}
          open={payOpen}
          onOpenChange={(next) => {
            if (!pending) setPayOpen(next);
          }}
          total={grandTotal}
          customer={customer}
          pending={pending}
          error={payError}
          onConfirm={confirmPayment}
        />
      ) : null}
    </div>
  );
}
