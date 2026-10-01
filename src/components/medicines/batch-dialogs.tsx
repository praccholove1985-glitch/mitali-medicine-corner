"use client";

import { useActionState, useState } from "react";
import { Pencil, Plus } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { createBatchAction, updateBatchPricesAction, type FormState } from "@/app/(app)/medicines/actions";

const initialState: FormState = {};

function FormAlert({ state }: { state: FormState }) {
  if (!state.error) return null;
  return (
    <Alert tone="danger" title="Couldn't save">
      {state.error}
      {state.reference ? <span className="mt-1 block text-xs">Reference: <span className="font-mono">{state.reference}</span></span> : null}
    </Alert>
  );
}

type AddBatchDialogProps = {
  medicineId: string;
  medicineName: string;
  /** Earliest accepted expiry (tomorrow in the branch's timezone), computed on the server. */
  minExpiry: string;
  defaultSalePrice: string | null;
  defaultMrp: string | null;
};

export function AddBatchDialog({ medicineId, medicineName, minExpiry, defaultSalePrice, defaultMrp }: AddBatchDialogProps) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    async (prev: FormState, formData: FormData) => {
      const result = await createBatchAction(prev, formData);
      if (result.ok) setOpen(false);
      return result;
    },
    initialState,
  );
  const v = (key: string, fallback = "") => state.values?.[key] ?? fallback;
  const err = state.fieldErrors ?? {};

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus aria-hidden />
          Add batch
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={formAction} noValidate className="flex min-h-0 flex-col">
          <input type="hidden" name="medicine_id" value={medicineId} />
          <DialogHeader>
            <DialogTitle>Add a batch of {medicineName}</DialogTitle>
            <DialogDescription>
              Records the stock you have on the shelf now. Each batch keeps its own expiry and cost.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {state.error ? <div className="sm:col-span-2"><FormAlert state={state} /></div> : null}
            <Field label="Batch number" htmlFor="add-batch-batch_number" required error={err.batch_number}>
              <Input name="batch_number" defaultValue={v("batch_number")} autoComplete="off" />
            </Field>
            <Field label="Expiry date" htmlFor="add-batch-expiry_date" required error={err.expiry_date} hint="Must be after today">
              <Input name="expiry_date" type="date" min={minExpiry} defaultValue={v("expiry_date")} />
            </Field>
            <Field label="Quantity on hand" htmlFor="add-batch-quantity" required error={err.quantity} hint="In single units">
              <Input name="quantity" inputMode="numeric" defaultValue={v("quantity")} />
            </Field>
            <Field label="Cost per unit" htmlFor="add-batch-purchase_price" required error={err.purchase_price} hint="What you paid">
              <Input name="purchase_price" inputMode="decimal" defaultValue={v("purchase_price")} placeholder="0.00" />
            </Field>
            <Field label="Sale price per unit" htmlFor="add-batch-sale_price" required error={err.sale_price}>
              <Input name="sale_price" inputMode="decimal" defaultValue={v("sale_price", defaultSalePrice ?? "")} placeholder="0.00" />
            </Field>
            <Field label="MRP per unit" htmlFor="add-batch-mrp" error={err.mrp}>
              <Input name="mrp" inputMode="decimal" defaultValue={v("mrp", defaultMrp ?? "")} placeholder="0.00" />
            </Field>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" loading={pending}>
              {pending ? "Saving" : "Add batch"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type EditBatchPricesDialogProps = {
  medicineId: string;
  batchId: string;
  batchNumber: string;
  salePrice: string;
  mrp: string | null;
};

export function EditBatchPricesDialog({ medicineId, batchId, batchNumber, salePrice, mrp }: EditBatchPricesDialogProps) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    async (prev: FormState, formData: FormData) => {
      const result = await updateBatchPricesAction(prev, formData);
      if (result.ok) setOpen(false);
      return result;
    },
    initialState,
  );
  const v = (key: string, fallback: string) => state.values?.[key] ?? fallback;
  const err = state.fieldErrors ?? {};

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="icon-sm" variant="ghost">
          <Pencil aria-hidden />
          <span className="sr-only">Edit prices for batch {batchNumber}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <form action={formAction} noValidate className="flex min-h-0 flex-col">
          <input type="hidden" name="batch_id" value={batchId} />
          <input type="hidden" name="medicine_id" value={medicineId} />
          <DialogHeader>
            <DialogTitle>Prices for batch {batchNumber}</DialogTitle>
            <DialogDescription>
              Corrects the selling price only. The cost this batch was bought at never changes, so past profit stays true.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <FormAlert state={state} />
            <Field label="Sale price per unit" htmlFor={`prices-${batchId}-sale_price`} required error={err.sale_price}>
              <Input name="sale_price" inputMode="decimal" defaultValue={v("sale_price", salePrice)} />
            </Field>
            <Field label="MRP per unit" htmlFor={`prices-${batchId}-mrp`} error={err.mrp}>
              <Input name="mrp" inputMode="decimal" defaultValue={v("mrp", mrp ?? "")} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" loading={pending}>
              {pending ? "Saving" : "Save prices"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
