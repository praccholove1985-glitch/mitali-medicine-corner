"use client";

import { useActionState, useState } from "react";
import { Trash2 } from "lucide-react";
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
import { writeOffExpiredAction } from "@/app/(app)/inventory/actions";
import type { FormState } from "@/app/(app)/medicines/actions";

const initialState: FormState = {};

type Props = {
  batchIds: string[];
  /** Units across those batches, for the confirmation text. */
  units: number;
};

export function WriteOffDialog({ batchIds, units }: Props) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    async (prev: FormState, formData: FormData) => {
      const result = await writeOffExpiredAction(prev, formData);
      if (result.ok) setOpen(false);
      return result;
    },
    initialState,
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="danger" size="sm">
          <Trash2 aria-hidden />
          Write off {batchIds.length} expired batch{batchIds.length === 1 ? "" : "es"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <form action={formAction} noValidate className="flex min-h-0 flex-col">
          {batchIds.map((id) => (
            <input key={id} type="hidden" name="batch_id" value={id} />
          ))}
          <DialogHeader>
            <DialogTitle>Write off expired stock?</DialogTitle>
            <DialogDescription>
              This removes {units} unit{units === 1 ? "" : "s"} across {batchIds.length} batch{batchIds.length === 1 ? "" : "es"} from stock.
              The batches and their history stay on record, and it can&rsquo;t be undone from here.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            {state.error ? (
              <Alert tone="danger" title="Couldn't write off">
                {state.error}
              </Alert>
            ) : null}
            <Field label="Note (optional)" htmlFor="writeoff-reason" hint="Defaults to “Expired stock written off”">
              <Input name="reason" defaultValue={state.values?.reason ?? ""} maxLength={300} autoComplete="off" />
            </Field>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Keep them
              </Button>
            </DialogClose>
            <Button type="submit" variant="danger" loading={pending}>
              {pending ? "Writing off" : "Write off"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
