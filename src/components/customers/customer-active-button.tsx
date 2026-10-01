"use client";

import { useActionState } from "react";
import { UserCheck, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setCustomerActiveAction } from "@/app/(app)/customers/actions";
import type { FormState } from "@/app/(app)/medicines/actions";

const initialState: FormState = {};

export function CustomerActiveButton({ customerId, isActive }: { customerId: string; isActive: boolean }) {
  const [state, formAction, pending] = useActionState(setCustomerActiveAction, initialState);
  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="id" value={customerId} />
      <input type="hidden" name="is_active" value={String(!isActive)} />
      <Button type="submit" variant="ghost" loading={pending}>
        {isActive ? <UserX aria-hidden /> : <UserCheck aria-hidden />}
        {isActive ? "Deactivate" : "Reactivate"}
      </Button>
      {state.error ? (
        <p role="alert" className="text-xs text-danger-text">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
