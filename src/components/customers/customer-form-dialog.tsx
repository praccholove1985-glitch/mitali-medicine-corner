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
import { saveCustomerFormAction } from "@/app/(app)/customers/actions";
import type { FormState } from "@/app/(app)/medicines/actions";

const initialState: FormState = {};

export type EditableCustomer = {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  creditLimit: string | null;
};

/** Add a customer, or edit one when `customer` is given. The balance is never editable here. */
export function CustomerFormDialog({ customer }: { customer?: EditableCustomer }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    async (prev: FormState, formData: FormData) => {
      const result = await saveCustomerFormAction(prev, formData);
      if (result.ok) setOpen(false);
      return result;
    },
    initialState,
  );
  const err = state.fieldErrors ?? {};
  const v = state.values;
  const idPrefix = customer ? `cust-${customer.id}` : "cust-new";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {customer ? (
          <Button variant="outline">
            <Pencil aria-hidden />
            Edit
          </Button>
        ) : (
          <Button>
            <UserPlus aria-hidden />
            Add customer
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <form action={formAction} noValidate className="flex min-h-0 flex-col">
          {customer ? <input type="hidden" name="id" value={customer.id} /> : null}
          <DialogHeader>
            <DialogTitle>{customer ? "Edit customer" : "Add customer"}</DialogTitle>
            <DialogDescription>
              {customer
                ? "What the customer owes is worked out from their ledger and can't be typed in here."
                : "Registered customers can buy on credit and have a statement."}
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
              <Input name="name" defaultValue={v?.name ?? customer?.name ?? ""} maxLength={120} autoComplete="off" />
            </Field>
            <Field label="Phone" htmlFor={`${idPrefix}-phone`} error={err.phone} hint="Used to find the customer at the till">
              <Input name="phone" type="tel" inputMode="tel" defaultValue={v?.phone ?? customer?.phone ?? ""} maxLength={32} autoComplete="off" />
            </Field>
            <Field label="Address" htmlFor={`${idPrefix}-address`} error={err.address}>
              <Input name="address" defaultValue={v?.address ?? customer?.address ?? ""} maxLength={300} autoComplete="off" />
            </Field>
            <Field
              label="Credit limit"
              htmlFor={`${idPrefix}-credit_limit`}
              error={err.credit_limit}
              hint="The most they may owe at once. Leave empty for no limit."
            >
              <Input
                name="credit_limit"
                inputMode="decimal"
                defaultValue={v?.credit_limit ?? customer?.creditLimit ?? ""}
                autoComplete="off"
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" loading={pending}>
              {pending ? "Saving" : customer ? "Save changes" : "Add customer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
