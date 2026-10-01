"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/common/data-table";
import { MoneyText } from "@/components/common/money-text";
import { ExpiryBadge } from "@/components/common/status-badge";
import { PackageSearch } from "lucide-react";

type SampleRow = { id: string; name: string; batch: string; qty: number; price: string; days: number };

// Layout samples only.
const sampleRows: SampleRow[] = [
  { id: "1", name: "Sample medicine A 500mg", batch: "SB-001", qty: 40, price: "1.50", days: 12 },
  { id: "2", name: "Sample medicine B 20mg", batch: "SB-014", qty: 100, price: "6.25", days: 75 },
  { id: "3", name: "Sample medicine C syrup", batch: "SB-207", qty: 18, price: "85.00", days: 400 },
];

const columns: DataTableColumn<SampleRow>[] = [
  { key: "name", header: "Medicine", cell: (r) => <span className="font-medium">{r.name}</span> },
  { key: "batch", header: "Batch", hideOnMobile: true, cell: (r) => <span className="font-mono text-xs">{r.batch}</span> },
  { key: "qty", header: "Qty", align: "right", cell: (r) => r.qty },
  { key: "price", header: "Price", align: "right", cell: (r) => <MoneyText amount={r.price} /> },
  { key: "expiry", header: "Expiry", cell: (r) => <ExpiryBadge daysToExpiry={r.days} /> },
];

type TableMode = "data" | "loading" | "empty" | "error";

export function DesignSystemDemo() {
  const [mode, setMode] = React.useState<TableMode>("data");
  const [name, setName] = React.useState("");
  const [submitted, setSubmitted] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const nameError = submitted && name.trim() === "" ? "Enter a name for the item." : undefined;

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (name.trim() === "") return;
    setSaving(true);
    window.setTimeout(() => setSaving(false), 900);
  }

  return (
    <>
      <Card className="mb-4">
        <CardHeader>
          <div>
            <CardTitle>Data table states</CardTitle>
            <CardDescription>Every list handles loading, error, empty and data.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Table state">
            {(["data", "loading", "empty", "error"] as const).map((m) => (
              <Button
                key={m}
                size="sm"
                variant={mode === m ? "primary" : "outline"}
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
              >
                {m}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <DataTable
            caption="Sample stock table"
            columns={columns}
            rows={mode === "data" ? sampleRows : []}
            getRowId={(r) => r.id}
            loading={mode === "loading"}
            error={mode === "error" ? "We couldn't load the stock list. Check your connection and try again." : undefined}
            onRetry={() => setMode("data")}
            empty={{
              icon: PackageSearch,
              title: "No batches match",
              description: "Try a different search or clear the filters.",
            }}
            pagination={mode === "data" ? { page: 1, pageCount: 3, total: 3, onPageChange: () => undefined } : undefined}
          />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Form</CardTitle>
              <CardDescription>Labelled fields with hint and inline error</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
              <Field label="Item name" htmlFor="ds-name" required hint="As printed on the pack." error={nameError}>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sample medicine" />
              </Field>
              <Field label="Dosage form" htmlFor="ds-form">
                <Select defaultValue="tablet">
                  <option value="tablet">Tablet</option>
                  <option value="capsule">Capsule</option>
                  <option value="syrup">Syrup</option>
                  <option value="injection">Injection</option>
                </Select>
              </Field>
              <Field label="Notes" htmlFor="ds-notes" hint="Optional">
                <Textarea />
              </Field>
              <div className="flex items-center gap-2">
                <Button type="submit" loading={saving}>
                  {saving ? "Saving" : "Save"}
                </Button>
                <Button type="button" variant="ghost" onClick={() => { setName(""); setSubmitted(false); }}>
                  Reset
                </Button>
              </div>
              {saving ? null : submitted && !nameError ? (
                <Alert tone="success">Form is valid (demo only, nothing is stored).</Alert>
              ) : null}
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Dialogs</CardTitle>
              <CardDescription>Focus is trapped, Esc closes, focus returns to the trigger</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline">Open form dialog</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Quick note</DialogTitle>
                  <DialogDescription>Dialogs scroll inside themselves on small screens.</DialogDescription>
                </DialogHeader>
                <DialogBody>
                  <Field label="Note" htmlFor="ds-dialog-note">
                    <Textarea placeholder="Type here" />
                  </Field>
                </DialogBody>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">Cancel</Button>
                  </DialogClose>
                  <DialogClose asChild>
                    <Button>Save note</Button>
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog>
              <DialogTrigger asChild>
                <Button variant="danger">Open confirm dialog</Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Cancel this entry?</DialogTitle>
                  <DialogDescription>
                    Destructive actions say exactly what will happen and name the
                    action on the button.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">Keep it</Button>
                  </DialogClose>
                  <DialogClose asChild>
                    <Button variant="danger">Cancel entry</Button>
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
