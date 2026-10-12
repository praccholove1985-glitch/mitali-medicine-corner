"use client";

import { useActionState, useState } from "react";
import { Pencil, UserPlus } from "lucide-react";
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
import { saveSupplierFormAction } from "@/app/(app)/suppliers/actions";
import type { FormState } from "@/app/(app)/medicines/actions";

const initialState: FormState = {};

export type EditableSupplier = {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  contactPerson: string | null;
};

/** Add a supplier, or edit one when `supplier` is given. The balance is never editable here. */
export function SupplierFormDialog({ supplier }: { supplier?: EditableSupplier }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    async (prev: FormState, formData: FormData) => {
      const result = await saveSupplierFormAction(prev, formData);
      if (result.ok) setOpen(false);
      return result;
    },
    initialState,
  );
  const err = state.fieldErrors ?? {};
  const v = state.values;
  const idPrefix = supplier ? `sup-${supplier.id}` : "sup-new";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {supplier ? (
          <Button variant="outline">
            <Pencil aria-hidden />
            Edit
          </Button>
        ) : (
          <Button>
            <UserPlus aria-hidden />
            Add supplier
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <form action={formAction} noValidate className="flex min-h-0 flex-col">
          {supplier ? <input type="hidden" name="id" value={supplier.id} /> : null}
          <DialogHeader>
            <DialogTitle>{supplier ? "Edit supplier" : "Add supplier"}</DialogTitle>
            <DialogDescription>
              {supplier
                ? "What you owe the supplier is worked out from the ledger and can't be typed in here."
                : "Suppliers you buy stock from. What you owe them comes from the ledger."}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            {state.error ? (
              <Alert tone="danger" title="Couldn't save">
                {state.error}
                {state.reference ? (
                  <span className="mt-1 block text-xs">
                    Reference: <span className="font-mono">{state.reference}</span>
                  </span>
                ) : null}
              </Alert>
            ) : null}
            <Field label="Name" htmlFor={`${idPrefix}-name`} required error={err.name}>
              <Input name="name" defaultValue={v?.name ?? supplier?.name ?? ""} maxLength={120} autoComplete="off" />
            </Field>
            <Field label="Contact person" htmlFor={`${idPrefix}-contact_person`} error={err.contact_person}>
              <Input name="contact_person" defaultValue={v?.contact_person ?? supplier?.contactPerson ?? ""} maxLength={120} autoComplete="off" />
            </Field>
            <Field label="Phone" htmlFor={`${idPrefix}-phone`} error={err.phone} hint="Shown on the supplier page">
              <Input name="phone" type="tel" inputMode="tel" defaultValue={v?.phone ?? supplier?.phone ?? ""} maxLength={32} autoComplete="off" />
            </Field>
            <Field label="Address" htmlFor={`${idPrefix}-address`} error={err.address}>
              <Input name="address" defaultValue={v?.address ?? supplier?.address ?? ""} maxLength={300} autoComplete="off" />
            </Field>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" loading={pending}>
              {pending ? "Saving" : supplier ? "Save changes" : "Add supplier"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
