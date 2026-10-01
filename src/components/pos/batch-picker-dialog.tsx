"use client";

import { useEffect, useState } from "react";
import { Layers } from "lucide-react";
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
import { ExpiryBadge } from "@/components/common/status-badge";
import { MoneyText } from "@/components/common/money-text";
import { LoadingState } from "@/components/common/loading-state";
import { formatDate } from "@/lib/dates";
import type { PosBatch } from "@/server/db/pos";

type Props = {
  medicineId: string;
  medicineName: string;
  selectedBatchId: string | null;
  onSelect: (batch: { id: string; label: string } | null) => void;
};

type Load = { status: "loading" } | { status: "ready"; batches: PosBatch[] } | { status: "error"; message: string };

/** Lists only sellable batches (unexpired, with stock), earliest expiry first. */
export function BatchPickerDialog({ medicineId, medicineName, selectedBatchId, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [load, setLoad] = useState<Load>({ status: "loading" });

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetch(`/api/pos/batches?medicine=${encodeURIComponent(medicineId)}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as { items?: PosBatch[]; error?: { message?: string } };
        if (!response.ok || !body.items) throw new Error(body.error?.message ?? "Couldn't load batches.");
        setLoad({ status: "ready", batches: body.items });
      })
      .catch((error: Error) => {
        if (error.name === "AbortError") return;
        setLoad({ status: "error", message: error.message });
      });
    return () => controller.abort();
  }, [open, medicineId]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setLoad({ status: "loading" });
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className={selectedBatchId ? "text-primary-text" : undefined}>
          <Layers aria-hidden />
          {selectedBatchId ? "Batch chosen" : "Batch: auto"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Choose a batch of {medicineName}</DialogTitle>
          <DialogDescription>
            Auto sells the earliest-expiring batch first. Pick one only if the customer needs a specific batch. Expired batches are never listed.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-2">
          {load.status === "loading" ? <LoadingState label="Loading batches" /> : null}
          {load.status === "error" ? <Alert tone="danger">{load.message}</Alert> : null}
          {load.status === "ready" ? (
            <>
              <button
                type="button"
                onClick={() => {
                  onSelect(null);
                  setOpen(false);
                }}
                aria-pressed={selectedBatchId === null}
                className="flex min-h-14 items-center justify-between rounded-lg border px-4 text-left hover:border-primary aria-pressed:border-primary aria-pressed:bg-primary-soft"
              >
                <span className="font-medium">Auto (earliest expiry first)</span>
                <span className="text-xs text-muted-foreground">Recommended</span>
              </button>
              {load.batches.length === 0 ? <Alert tone="warning">No sellable batches are left.</Alert> : null}
              {load.batches.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => {
                    onSelect({ id: b.id, label: `${b.batchNumber} · ${formatDate(b.expiryDate)}` });
                    setOpen(false);
                  }}
                  aria-pressed={selectedBatchId === b.id}
                  className="flex min-h-14 items-center justify-between gap-3 rounded-lg border px-4 py-2 text-left hover:border-primary aria-pressed:border-primary aria-pressed:bg-primary-soft"
                >
                  <span className="flex flex-col">
                    <span className="font-mono text-sm font-medium">{b.batchNumber}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(b.expiryDate)} · {b.quantity} on hand
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    <MoneyText amount={b.salePrice} fractionDigits={2} className="font-medium" />
                    <ExpiryBadge daysToExpiry={b.daysToExpiry} />
                  </span>
                </button>
              ))}
            </>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
