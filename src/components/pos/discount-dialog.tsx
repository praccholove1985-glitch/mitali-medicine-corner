"use client";

import { useState } from "react";
import { Percent } from "lucide-react";
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
import type { DiscountType } from "@/lib/pos/cart";

type Props = {
  lineId: string;
  medicineName: string;
  discountType: DiscountType;
  discountValue: string;
  onApply: (type: DiscountType, value: string) => void;
};

export function DiscountDialog({ lineId, medicineName, discountType, discountValue, onApply }: Props) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<DiscountType>(discountType);
  const [value, setValue] = useState(discountValue);

  const active = discountType !== "NONE" && discountValue !== "";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setType(discountType);
          setValue(discountValue);
        }
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className={active ? "text-primary-text" : undefined}>
          <Percent aria-hidden />
          {active ? (discountType === "PERCENT" ? `${discountValue}% off` : `৳${discountValue} off`) : "Discount"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            onApply(type, type === "NONE" ? "" : value.trim());
            setOpen(false);
          }}
        >
          <DialogHeader>
            <DialogTitle>Discount on {medicineName}</DialogTitle>
            <DialogDescription>
              The server checks the amount against what your role may give. Above that, a manager is needed.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <Field label="Type" htmlFor={`${lineId}-dtype`}>
              <Select value={type} onChange={(e) => setType(e.target.value as DiscountType)}>
                <option value="NONE">No discount</option>
                <option value="PERCENT">Percent of the line</option>
                <option value="AMOUNT">Amount in taka</option>
              </Select>
            </Field>
            {type !== "NONE" ? (
              <Field label={type === "PERCENT" ? "Percent" : "Amount (৳)"} htmlFor={`${lineId}-dvalue`}>
                <Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} autoFocus autoComplete="off" />
              </Field>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit">Apply</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
