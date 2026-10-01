"use client";

import { useActionState, useState } from "react";
import { Banknote } from "lucide-react";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { formatMoney, formatPaisa, parsePaisa } from "@/domain/money";
import { METHODS_WITH_REFERENCE, MONEY_PAYMENT_METHODS, PAYMENT_LABELS } from "@/lib/validation/sale";
import { receivePaymentAction } from "@/app/(app)/customers/actions";
import type { FormState } from "@/app/(app)/medicines/actions";

const initialState: FormState = {};

type Props = {
  customerId: string;
  customerName: string;
  /** What the server says is due right now (decimal string). Display only; the database re-checks. */
  due: string;
  /** Generated on the server per page render: a double click or retry reuses it, so it records once. */
  requestId: string;
};

export function ReceivePaymentDialog({ customerId, customerName, due, requestId }: Props) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    async (prev: FormState, formData: FormData) => {
      const result = await receivePaymentAction(prev, formData);
      if (result.ok) setOpen(false);
      return result;
    },
    initialState,
  );
  const [method, setMethod] = useState(state.values?.method ?? "CASH");
  const [amount, setAmount] = useState(state.values?.amount ?? "");
  const err = state.fieldErrors ?? {};

  // Preview only, in whole paisa. The database decides whether the payment is accepted.
  const duePaisa = parsePaisa(due);
  const paid = parsePaisa(amount);
  const remaining = duePaisa !== null && paid !== null && paid > BigInt(0) ? duePaisa - paid : null;
  const over = remaining !== null && remaining < BigInt(0);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Banknote aria-hidden />
          Receive payment
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <form action={formAction} noValidate className="flex min-h-0 flex-col">
          <input type="hidden" name="customer_id" value={customerId} />
          <input type="hidden" name="client_request_id" value={requestId} />
          <DialogHeader>
            <DialogTitle>Receive payment from {customerName}</DialogTitle>
            <DialogDescription>
              Owes {formatMoney(due, { fractionDigits: 2 })}. The payment is recorded in their ledger and can&rsquo;t be edited later.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            {state.error ? (
              <Alert tone="danger" title="Couldn't record the payment">
                {state.error}
                {state.reference ? (
                  <span className="mt-1 block text-xs">
                    Reference: <span className="font-mono">{state.reference}</span>
                  </span>
                ) : null}
              </Alert>
            ) : null}
            <Field label="Paid by" htmlFor="rcv-method" required error={err.method}>
              <Select name="method" value={method} onChange={(e) => setMethod(e.target.value)}>
                {MONEY_PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_LABELS[m]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Amount" htmlFor="rcv-amount" required error={err.amount}>
              <Input name="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoComplete="off" />
            </Field>
            <div className="-mt-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {remaining === null ? null : over ? (
                  <span className="font-semibold text-danger-text">More than is owed (not allowed)</span>
                ) : (
                  <>
                    Still owed after this:{" "}
                    <span className="font-semibold text-foreground">{formatMoney(formatPaisa(remaining), { fractionDigits: 2 })}</span>
                  </>
                )}
              </p>
              <Button type="button" size="sm" variant="outline" onClick={() => setAmount(due)}>
                Pay all
              </Button>
            </div>
            {(METHODS_WITH_REFERENCE as readonly string[]).includes(method) ? (
              <Field label="Transaction ID" htmlFor="rcv-reference" error={err.reference} hint="Optional. From the bKash, Nagad, Rocket, card or bank receipt.">
                <Input name="reference" defaultValue={state.values?.reference ?? ""} maxLength={64} autoComplete="off" />
              </Field>
            ) : null}
            <Field label="Note" htmlFor="rcv-note" error={err.note} hint="Optional">
              <Input name="note" defaultValue={state.values?.note ?? ""} maxLength={300} autoComplete="off" />
            </Field>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" loading={pending}>
              {pending ? "Recording" : "Record payment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
