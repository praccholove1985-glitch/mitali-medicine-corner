"use client";

import { useActionState, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { saveCatalogueAction, type FormState } from "@/app/(app)/medicines/actions";

const initialState: FormState = {};

type CatalogueDialogProps = {
  kind: "company" | "category" | "subcategory";
  /** Present when editing. */
  item?: { id: string; name: string; isActive: boolean };
  /** Required for subcategories. */
  categoryId?: string;
  triggerLabel?: string;
};

const NOUN = { company: "company", category: "category", subcategory: "subcategory" } as const;

export function CatalogueDialog({ kind, item, categoryId, triggerLabel }: CatalogueDialogProps) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    async (prev: FormState, formData: FormData) => {
      const result = await saveCatalogueAction(prev, formData);
      if (result.ok) setOpen(false);
      return result;
    },
    initialState,
  );
  const noun = NOUN[kind];
  const err = state.fieldErrors ?? {};
  const editing = Boolean(item);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {editing ? (
          <Button size="icon-sm" variant="ghost">
            <Pencil aria-hidden />
            <span className="sr-only">Edit {item?.name}</span>
          </Button>
        ) : (
          <Button size="sm" variant="outline">
            <Plus aria-hidden />
            {triggerLabel ?? `Add ${noun}`}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <form action={formAction} noValidate className="flex min-h-0 flex-col">
          <input type="hidden" name="kind" value={kind} />
          {item ? <input type="hidden" name="id" value={item.id} /> : null}
          {categoryId ? <input type="hidden" name="category_id" value={categoryId} /> : null}
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${noun}` : `Add a ${noun}`}</DialogTitle>
            <DialogDescription>
              {editing ? "Renaming updates every medicine that uses it." : "Names must be unique, ignoring capital letters."}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            {state.error ? (
              <Alert tone="danger" title="Couldn't save">
                {state.error}
              </Alert>
            ) : null}
            <Field label="Name" htmlFor={`${kind}-name`} required error={err.name}>
              <Input name="name" defaultValue={state.values?.name ?? item?.name ?? ""} autoComplete="off" autoFocus />
            </Field>
            {editing ? (
              <Checkbox
                id={`${kind}-active`}
                name="is_active"
                label="Active"
                hint="Retired entries stay on old medicines but can't be chosen for new ones."
                defaultChecked={state.values ? state.values.is_active === "on" : (item?.isActive ?? true)}
              />
            ) : (
              <input type="hidden" name="is_active" value="on" />
            )}
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" loading={pending}>
              {pending ? "Saving" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
