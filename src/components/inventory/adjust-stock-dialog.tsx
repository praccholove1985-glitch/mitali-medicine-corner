"use client";

import { useActionState, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
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
import { Input, Select, Textarea } from "@/components/ui/input";
import { adjustStockAction } from "@/app/(app)/inventory/actions";
import type { FormState } from "@/app/(app)/medicines/actions";

const initialState: FormState = {};

type Props = {
  medicineId: string;
  batchId: string;
  batchNumber: string;
  /** Units currently in the batch. */
  quantity: number;
  isExpired: boolean;
  /** Generated on the server per page render: a double click or retry reuses it, so it adjusts once. */
  requestId: string;
};

export function AdjustStockDialog({ medicineId, batchId, batchNumber, quantity, isExpired, requestId }: Props) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    async (prev: FormState, formData: FormData) => {
      const result = await adjustStockAction(prev, formData);
      if (result.ok) setOpen(false);
      return result;
    },
    initialState,
  );
  const [type, setType] = useState(state.values?.movement_type ?? "ADJUSTMENT");
  const [direction, setDirection] = useState(state.values?.direction ?? "remove");
  const [amount, setAmount] = useState(state.values?.quantity ?? "");

  const forcedRemove = type === "DAMAGE" || type === "EXPIRED";
  const effectiveDirection = forcedRemove ? "remove" : direction;
  const err = state.fieldErrors ?? {};

  // Display only. The database re-checks the sign and the floor.
  const n = /^[1-9]\d{0,8}$/.test(amount) ? Number(amount) : null;
  const after = n === null ? null : quantity + (effectiveDirection === "add" ? n : -n);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="icon-sm" variant="ghost">
          <SlidersHorizontal aria-hidden />
          <span className="sr-only">Adjust stock for batch {batchNumber}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <form action={formAction} noValidate className="flex min-h-0 flex-col">
          <input type="hidden" name="batch_id" value={batchId} />
          <input type="hidden" name="medicine_id" value={medicineId} />
          <input type="hidden" name="client_request_id" value={requestId} />
          {forcedRemove ? <input type="hidden" name="direction" value="remove" /> : null}
          <DialogHeader>
            <DialogTitle>Adjust batch {batchNumber}</DialogTitle>
            <DialogDescription>
              {quantity} unit{quantity === 1 ? "" : "s"} on hand. Every change is recorded with your name and reason and can&rsquo;t be edited later.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            {state.error ? (
              <Alert tone="danger" title="Couldn't save">
                {state.error}
                {state.reference ? <span className="mt-1 block text-xs">Reference: <span className="font-mono">{state.reference}</span></span> : null}
              </Alert>
            ) : null}
            <Field label="What happened?" htmlFor={`adj-${batchId}-type`} error={err.movement_type}>
              <Select name="movement_type" value={type} onChange={(e) => setType(e.target.value)}>
                <option value="ADJUSTMENT">Stock count differs from the system</option>
                <option value="CORRECTION">Correct an earlier mistake</option>
                <option value="DAMAGE">Damaged or lost</option>
                {isExpired ? <option value="EXPIRED">Expired, remove from shelf</option> : null}
              </Select>
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Stock goes" htmlFor={`adj-${batchId}-direction`} error={err.direction}>
                <Select
                  name={forcedRemove ? undefined : "direction"}
                  value={effectiveDirection}
                  onChange={(e) => setDirection(e.target.value)}
                  disabled={forcedRemove}
                >
                  <option value="remove">Down (remove)</option>
                  <option value="add">Up (add)</option>
                </Select>
              </Field>
              <Field label="Units" htmlFor={`adj-${batchId}-quantity`} required error={err.quantity}>
                <Input name="quantity" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} autoComplete="off" />
              </Field>
            </div>
            {after !== null ? (
              <p className="text-sm text-muted-foreground" aria-live="polite">
                New total:{" "}
                <span className={after < 0 ? "font-semibold text-danger-text" : "font-semibold text-foreground"}>
                  {after < 0 ? `${after} (not allowed)` : after}
                </span>
              </p>
            ) : null}
            <Field label="Reason" htmlFor={`adj-${batchId}-reason`} required error={err.reason} hint="Shown in the stock history">
              <Textarea name="reason" defaultValue={state.values?.reason ?? ""} maxLength={300} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" loading={pending}>
              {pending ? "Saving" : "Save adjustment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
