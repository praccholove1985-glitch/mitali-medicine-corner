"use client";

import { useEffect, useState, useTransition } from "react";
import { FolderOpen, Save, Trash2 } from "lucide-react";
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
import { LoadingState } from "@/components/common/loading-state";
import type { SaleDraft } from "@/server/db/pos";
import type { ActionFailure } from "@/app/(app)/pos/actions";

type DraftRow = SaleDraft & { customerName: string | null };
type Load = { status: "loading" } | { status: "ready"; drafts: DraftRow[] } | { status: "error"; message: string };

export function SaveCartDialog({
  disabled,
  initialName,
  onSave,
}: {
  disabled: boolean;
  initialName: string;
  onSave: (name: string) => Promise<{ ok: true } | ActionFailure>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setName(initialName);
          setError(null);
        }
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="md" disabled={disabled}>
          <Save aria-hidden />
          Save cart
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            startTransition(async () => {
              const result = await onSave(name);
              if (result.ok) setOpen(false);
              else setError(result.message);
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>Save this cart for later</DialogTitle>
            <DialogDescription>
              Keeps the items, quantities and discounts. Nothing is sold and no stock is held. Prices are worked out again when you resume.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            {error ? <Alert tone="danger">{error}</Alert> : null}
            <Field label="Name (optional)" htmlFor="draft-name" hint="e.g. the customer's name">
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus autoComplete="off" />
            </Field>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" loading={pending}>
              {pending ? "Saving" : "Save cart"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function SavedCartsDialog({
  onResume,
  onDelete,
}: {
  onResume: (draft: DraftRow) => void;
  onDelete: (id: string) => Promise<{ ok: true } | ActionFailure>;
}) {
  const [open, setOpen] = useState(false);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [reload, setReload] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetch("/api/pos/drafts", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as { items?: DraftRow[]; error?: { message?: string } };
        if (!response.ok || !body.items) throw new Error(body.error?.message ?? "Couldn't load saved carts.");
        setLoad({ status: "ready", drafts: body.items });
      })
      .catch((e: Error) => {
        if (e.name === "AbortError") return;
        setLoad({ status: "error", message: e.message });
      });
    return () => controller.abort();
  }, [open, reload]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setLoad({ status: "loading" });
          setError(null);
        }
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="md">
          <FolderOpen aria-hidden />
          Saved carts
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Saved carts</DialogTitle>
          <DialogDescription>Your own carts, kept for later. Resuming replaces the current cart.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-2">
          {error ? <Alert tone="danger">{error}</Alert> : null}
          {load.status === "loading" ? <LoadingState label="Loading saved carts" /> : null}
          {load.status === "error" ? <Alert tone="danger">{load.message}</Alert> : null}
          {load.status === "ready" && load.drafts.length === 0 ? (
            <p className="px-1 py-6 text-center text-sm text-muted-foreground">No saved carts yet.</p>
          ) : null}
          {load.status === "ready"
            ? load.drafts.map((d) => (
                <div key={d.id} className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">{d.name ?? "Unnamed cart"}</span>
                    <span className="text-xs text-muted-foreground">
                      {d.items.length} line{d.items.length === 1 ? "" : "s"}
                      {d.customerName ? ` · ${d.customerName}` : ""} · {new Date(d.updatedAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      onClick={() => {
                        onResume(d);
                        setOpen(false);
                      }}
                    >
                      Resume
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() =>
                        startTransition(async () => {
                          setError(null);
                          const result = await onDelete(d.id);
                          if (result.ok) setReload((n) => n + 1);
                          else setError(result.message);
                        })
                      }
                    >
                      <Trash2 aria-hidden />
                      <span className="sr-only">Delete saved cart {d.name ?? ""}</span>
                    </Button>
                  </div>
                </div>
              ))
            : null}
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
