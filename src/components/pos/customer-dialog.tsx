"use client";

import { useEffect, useState, useTransition } from "react";
import { UserPlus, UserRound } from "lucide-react";
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
import { MoneyText } from "@/components/common/money-text";
import type { PosCustomer } from "@/server/db/pos";
import type { CustomerResult } from "@/app/(app)/pos/actions";

type Props = {
  customer: PosCustomer | null;
  onSelect: (customer: PosCustomer | null) => void;
  saveCustomer: (input: unknown) => Promise<CustomerResult>;
  /** Without customer.view the till can only sell to walk-ins. */
  disabled?: boolean;
};

type Results = { query: string; items: PosCustomer[]; error?: string };

export function CustomerDialog({ customer, onSelect, saveCustomer, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Results | null>(null);
  const [mode, setMode] = useState<"search" | "new">("search");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open || mode !== "search") return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/pos/customers?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal, cache: "no-store" });
        const body = (await response.json()) as { items?: PosCustomer[]; error?: { message?: string } };
        if (!response.ok || !body.items) throw new Error(body.error?.message ?? "Search failed.");
        setResults({ query, items: body.items });
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setResults({ query, items: [], error: (e as Error).message });
      }
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, mode, query]);

  function create() {
    setError(null);
    startTransition(async () => {
      const result = await saveCustomer({ name, phone });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onSelect(result.customer);
      setOpen(false);
    });
  }

  const fresh = results && results.query === query;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setMode("search");
          setQuery("");
          setResults(null);
          setError(null);
          setName("");
          setPhone("");
        }
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="md" disabled={disabled} className="w-full justify-start">
          <UserRound aria-hidden />
          <span className="truncate">{customer ? customer.name : "Walk-in customer"}</span>
          <span className="ml-auto text-xs text-muted-foreground">{customer ? "Change" : "Choose"}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === "search" ? "Choose a customer" : "New customer"}</DialogTitle>
          <DialogDescription>
            {mode === "search"
              ? "Walk-in customers can pay now. Credit (pay later) needs a registered customer."
              : "Only a name is needed. You can add more details later."}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          {mode === "search" ? (
            <>
              <Field label="Search by name or phone" htmlFor="customer-search">
                <Input value={query} onChange={(e) => setQuery(e.target.value)} autoFocus autoComplete="off" inputMode="search" />
              </Field>
              <Button
                variant="outline"
                onClick={() => {
                  onSelect(null);
                  setOpen(false);
                }}
                aria-pressed={customer === null}
                className="justify-start"
              >
                <UserRound aria-hidden />
                Walk-in customer
              </Button>
              {results?.error ? <Alert tone="danger">{results.error}</Alert> : null}
              <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto" aria-label="Customers">
                {(fresh ? results.items : []).map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(c);
                        setOpen(false);
                      }}
                      aria-pressed={customer?.id === c.id}
                      className="flex min-h-14 w-full items-center justify-between gap-3 rounded-lg border px-4 py-2 text-left hover:border-primary aria-pressed:border-primary aria-pressed:bg-primary-soft"
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">{c.name}</span>
                        <span className="text-xs text-muted-foreground">{c.phone ?? "No phone"}</span>
                      </span>
                      <span className="flex flex-col items-end text-xs">
                        <span className="text-muted-foreground">Owes</span>
                        <MoneyText amount={c.balance} fractionDigits={2} className="font-medium" />
                      </span>
                    </button>
                  </li>
                ))}
                {fresh && results.items.length === 0 && !results.error ? (
                  <li className="px-1 py-3 text-sm text-muted-foreground">No customer matches. Add them as a new customer.</li>
                ) : null}
              </ul>
            </>
          ) : (
            <>
              {error ? <Alert tone="danger">{error}</Alert> : null}
              <Field label="Name" htmlFor="new-customer-name" required>
                <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus autoComplete="off" />
              </Field>
              <Field label="Phone" htmlFor="new-customer-phone" hint="Optional, e.g. 01711111111">
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="off" />
              </Field>
            </>
          )}
        </DialogBody>
        <DialogFooter>
          {mode === "search" ? (
            <>
              <DialogClose asChild>
                <Button variant="outline">Close</Button>
              </DialogClose>
              <Button onClick={() => setMode("new")}>
                <UserPlus aria-hidden />
                New customer
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setMode("search")}>
                Back
              </Button>
              <Button onClick={create} loading={pending} disabled={name.trim() === ""}>
                {pending ? "Saving" : "Save and use"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
