"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { MoneyText } from "@/components/common/money-text";
import { formatMoney, formatPaisa, parsePaisa } from "@/domain/money";
import { METHODS_WITH_REFERENCE, PAYMENT_LABELS, PAYMENT_METHODS, type PaymentMethod } from "@/lib/validation/sale";
import type { PosCustomer } from "@/server/db/pos";

export type PaymentRow = { id: string; method: PaymentMethod; amount: string; reference: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Grand total from the server's quote, e.g. "1000.00". */
  total: string;
  customer: PosCustomer | null;
  pending: boolean;
  /** A message from the server about the last attempt. */
  error: string | null;
  onConfirm: (payments: Array<{ method: PaymentMethod; amount: string; reference?: string }>) => void;
};

let rowCounter = 0;
const newRow = (method: PaymentMethod, amount: string): PaymentRow => ({
  id: `p${++rowCounter}`,
  method,
  amount,
  reference: "",
});

/**
 * Splits a total across payment methods. The arithmetic here (in whole paisa, never
 * floats) only tells the cashier how much is still unallocated; the database checks
 * the real payments against the real total and rejects anything that is not exact.
 * Mount with a fresh `key` each time it opens so it starts clean.
 */
export function PaymentDialog({ open, onOpenChange, total, customer, pending, error, onConfirm }: Props) {
  const [rows, setRows] = useState<PaymentRow[]>(() => [newRow("CASH", total)]);
  const [tendered, setTendered] = useState("");

  const totalPaisa = parsePaisa(total) ?? BigInt(0);
  const parsed = rows.map((r) => parsePaisa(r.amount));
  const allValid = parsed.every((p) => p !== null && p > BigInt(0));
  const entered = parsed.reduce<bigint>((sum, p) => sum + (p ?? BigInt(0)), BigInt(0));
  const remaining = totalPaisa - entered;
  const exact = allValid && remaining === BigInt(0);
  const creditRow = rows.find((r) => r.method === "CREDIT");
  const cashRow = rows.find((r) => r.method === "CASH");
  const cashPaisa = cashRow ? (parsePaisa(cashRow.amount) ?? BigInt(0)) : BigInt(0);
  const tenderedPaisa = tendered.trim() === "" ? null : parsePaisa(tendered);
  const change = tenderedPaisa !== null && cashRow && tenderedPaisa >= cashPaisa ? tenderedPaisa - cashPaisa : null;

  const creditNeedsCustomer = creditRow !== undefined && customer === null;
  const canConfirm = exact && !creditNeedsCustomer && !pending;

  function update(id: string, patch: Partial<PaymentRow>) {
    setRows((current) => current.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function addRow() {
    const used = new Set(rows.map((r) => r.method));
    const next = PAYMENT_METHODS.find((m) => !used.has(m) && (m !== "CREDIT" || customer !== null)) ?? "CASH";
    setRows((current) => [...current, newRow(next, remaining > BigInt(0) ? formatPaisa(remaining) : "")]);
  }

  function fillRemaining(id: string) {
    const row = rows.find((r) => r.id === id);
    const own = row ? (parsePaisa(row.amount) ?? BigInt(0)) : BigInt(0);
    const value = remaining + own;
    if (value > BigInt(0)) update(id, { amount: formatPaisa(value) });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (!canConfirm) return;
            onConfirm(
              rows.map((r) => ({
                method: r.method,
                amount: formatPaisa(parsePaisa(r.amount) ?? BigInt(0)),
                ...(r.reference.trim() ? { reference: r.reference.trim() } : {}),
              })),
            );
          }}
          className="flex min-h-0 flex-col"
        >
          <DialogHeader>
            <DialogTitle>Take payment</DialogTitle>
            <DialogDescription>Split the total across cash, mobile banking, card, bank or credit. It must add up exactly.</DialogDescription>
          </DialogHeader>

          <DialogBody className="flex flex-col gap-4">
            <div className="flex items-baseline justify-between rounded-lg bg-muted px-4 py-3">
              <span className="text-sm text-muted-foreground">Total to pay</span>
              <MoneyText amount={total} fractionDigits={2} className="text-3xl font-semibold" />
            </div>

            {error ? (
              <Alert tone="danger" title="Couldn't complete the sale">
                {error}
              </Alert>
            ) : null}

            <ul className="flex flex-col gap-3" aria-label="Payments">
              {rows.map((row, index) => {
                const needsRef = METHODS_WITH_REFERENCE.includes(row.method);
                const invalid = row.amount !== "" && parsePaisa(row.amount) === null;
                return (
                  <li key={row.id} className="rounded-lg border p-3">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
                      <Field label={`Method ${index + 1}`} htmlFor={`${row.id}-method`}>
                        <Select value={row.method} onChange={(e) => update(row.id, { method: e.target.value as PaymentMethod })}>
                          {PAYMENT_METHODS.map((m) => (
                            <option key={m} value={m} disabled={m === "CREDIT" && customer === null}>
                              {PAYMENT_LABELS[m]}
                              {m === "CREDIT" && customer === null ? " (choose a customer)" : ""}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field
                        label="Amount (৳)"
                        htmlFor={`${row.id}-amount`}
                        error={invalid ? "Up to 2 decimals, e.g. 250.50" : undefined}
                      >
                        <Input inputMode="decimal" value={row.amount} onChange={(e) => update(row.id, { amount: e.target.value })} autoComplete="off" />
                      </Field>
                      <div className="flex items-end gap-1">
                        <Button type="button" variant="outline" size="md" onClick={() => fillRemaining(row.id)} disabled={remaining === BigInt(0) && parsed[index] !== null}>
                          Rest
                        </Button>
                        {rows.length > 1 ? (
                          <Button type="button" variant="ghost" size="icon" onClick={() => setRows((c) => c.filter((r) => r.id !== row.id))}>
                            <Trash2 aria-hidden />
                            <span className="sr-only">Remove payment {index + 1}</span>
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    {needsRef ? (
                      <Field label="Transaction reference (optional)" htmlFor={`${row.id}-ref`} className="mt-3">
                        <Input value={row.reference} onChange={(e) => update(row.id, { reference: e.target.value })} maxLength={64} autoComplete="off" />
                      </Field>
                    ) : null}
                  </li>
                );
              })}
            </ul>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button type="button" variant="outline" size="sm" onClick={addRow} disabled={rows.length >= PAYMENT_METHODS.length}>
                <Plus aria-hidden />
                Add another method
              </Button>
              <p
                aria-live="polite"
                className={
                  exact
                    ? "text-sm font-medium text-success-text"
                    : remaining < BigInt(0)
                      ? "text-sm font-medium text-danger-text"
                      : "text-sm font-medium text-warning-text"
                }
              >
                {!allValid
                  ? "Enter a valid amount for every method."
                  : exact
                    ? "Adds up exactly."
                    : remaining > BigInt(0)
                      ? `৳${formatPaisa(remaining)} still to allocate`
                      : `Over by ৳${formatPaisa(-remaining)}`}
              </p>
            </div>

            {cashRow ? (
              <div className="grid grid-cols-1 items-end gap-3 rounded-lg bg-muted/60 p-3 sm:grid-cols-2">
                <Field label="Cash given by customer (optional)" htmlFor="tendered" hint="Only to work out the change. It isn't recorded.">
                  <Input inputMode="decimal" value={tendered} onChange={(e) => setTendered(e.target.value)} autoComplete="off" />
                </Field>
                <p className="text-sm" aria-live="polite">
                  {change !== null ? (
                    <>
                      Change to give: <strong className="text-lg">৳{formatPaisa(change)}</strong>
                    </>
                  ) : tenderedPaisa !== null ? (
                    <span className="text-warning-text">Less than the cash amount.</span>
                  ) : null}
                </p>
              </div>
            ) : null}

            {creditRow ? (
              customer ? (
                <Alert tone="info" title={`On credit: ${customer.name}`}>
                  Currently owes {formatMoney(customer.balance) ?? "—"}
                  {customer.creditLimit ? ` · credit limit ${formatMoney(customer.creditLimit)}` : " · no credit limit set"}. The server checks the limit.
                </Alert>
              ) : (
                <Alert tone="warning" title="Credit needs a customer">
                  Choose or add a customer before selling on credit.
                </Alert>
              )
            ) : null}
          </DialogBody>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" size="lg">
                Back to cart
              </Button>
            </DialogClose>
            <Button type="submit" size="pos" loading={pending} disabled={!canConfirm}>
              {pending ? "Completing" : `Complete sale · ৳${formatMoney(total, { symbol: false }) ?? total}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
