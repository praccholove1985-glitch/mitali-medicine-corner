"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { MoneyText } from "@/components/common/money-text";
import { LookupPicker } from "@/components/purchases/lookup-picker";
import { useLookup, usePurchaseQuote } from "@/components/purchases/hooks";
import { formatMoney, formatPaisa, parsePaisa } from "@/domain/money";
import { EXPIRY_NEAR_DAYS, purchaseLineSchema, purchasePaymentSchema, type PurchaseLineInput } from "@/lib/validation/purchase";
import { METHODS_WITH_REFERENCE, MONEY_PAYMENT_METHODS, PAYMENT_LABELS } from "@/lib/validation/sale";
import type { CreatePurchaseResult } from "@/app/(app)/purchases/actions";
import type { PurchaseMedicine, PurchaseQuoteLine } from "@/server/db/purchases";

type DiscountType = "NONE" | "AMOUNT" | "PERCENT";

type Line = {
  key: string;
  medicine: PurchaseMedicine | null;
  medQuery: string;
  batch: string;
  expiry: string;
  qty: string;
  free: string;
  price: string;
  dtype: DiscountType;
  dvalue: string;
  tax: string;
  sale: string;
  mrp: string;
};

type PaymentRow = { key: string; method: string; amount: string; reference: string };
type Supplier = { id: string; name: string; phone: string | null };

const blankLine = (key: string): Line => ({
  key, medicine: null, medQuery: "", batch: "", expiry: "", qty: "", free: "", price: "", dtype: "NONE", dvalue: "", tax: "", sale: "", mrp: "",
});

const pickMedicines = (body: unknown) => ((body as { medicines?: PurchaseMedicine[] }).medicines ?? []);
const pickSuppliers = (body: unknown) => ((body as { suppliers?: Supplier[] }).suppliers ?? []);

/** What the user typed, shaped for validation. Prices stay text; nothing is added up here. */
function candidate(l: Line): Record<string, unknown> {
  const whole = (v: string) => (v.trim() === "" ? 0 : /^\d+$/.test(v.trim()) ? Number(v.trim()) : Number.NaN);
  return {
    medicine_id: l.medicine?.id ?? "",
    batch_number: l.batch,
    expiry_date: l.expiry,
    quantity: whole(l.qty),
    free_quantity: whole(l.free),
    unit_price: l.price,
    ...(l.dtype !== "NONE" ? { discount_type: l.dtype, discount_value: l.dvalue } : {}),
    ...(l.tax.trim() !== "" ? { tax_rate: l.tax } : {}),
    ...(l.sale.trim() !== "" ? { sale_price: l.sale } : {}),
    ...(l.mrp.trim() !== "" ? { mrp: l.mrp } : {}),
  };
}

function lineProblem(l: Line): { input: PurchaseLineInput | null; problem: string | null } {
  if (!l.medicine) return { input: null, problem: "Choose a medicine." };
  const r = purchaseLineSchema.safeParse(candidate(l));
  if (r.success) return { input: r.data, problem: null };
  return { input: null, problem: r.error.issues[0]?.message ?? "Check this line." };
}

type Props = {
  /** Generated on the server per page render: a double click or retry reuses it, so it records once. */
  requestId: string;
  today: string;
  initialSupplier: Supplier | null;
  createPurchase: (input: unknown) => Promise<CreatePurchaseResult>;
};

export function PurchaseForm({ requestId, today, initialSupplier, createPurchase }: Props) {
  const router = useRouter();
  const counter = useRef(1);
  const nextKey = (prefix: string) => `${prefix}${++counter.current}`;

  const [supplier, setSupplier] = useState<Supplier | null>(initialSupplier);
  const [supplierQuery, setSupplierQuery] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([blankLine("l1")]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<Extract<CreatePurchaseResult, { ok: false }> | null>(null);

  const suppliers = useLookup("/api/purchases/suppliers", supplierQuery, pickSuppliers, supplier === null);

  const checks = lines.map(lineProblem);
  const allLinesValid = lines.length > 0 && checks.every((c) => c.input !== null);
  const items = allLinesValid ? checks.map((c) => c.input as PurchaseLineInput) : null;
  const quoteState = usePurchaseQuote(supplier?.id ?? null, items as Array<Record<string, unknown>> | null);
  const quote = quoteState.status === "ready" ? quoteState.quote : null;

  const paymentChecks = payments.map((p) => purchasePaymentSchema.safeParse({ method: p.method, amount: p.amount, reference: p.reference || undefined }));
  const paymentsValid = paymentChecks.every((c) => c.success);

  // Display only, in whole paisa. The database decides whether the payments are accepted.
  const grand = quote ? parsePaisa(quote.totals.grandTotal) : null;
  let paidPaisa = BigInt(0);
  for (const c of paymentChecks) if (c.success) paidPaisa += parsePaisa(c.data.amount) ?? BigInt(0);
  const remaining = grand === null ? null : grand - paidPaisa;
  const overpaid = remaining !== null && remaining < BigInt(0);

  const canSave =
    supplier !== null && invoiceNo.trim() !== "" && invoiceDate !== "" && quote !== null && paymentsValid && !overpaid && !submitting;

  function patchLine(key: string, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  async function save() {
    if (!canSave || items === null || supplier === null) return;
    setSubmitting(true);
    setFailure(null);
    try {
      const result = await createPurchase({
        clientRequestId: requestId,
        supplierId: supplier.id,
        supplierInvoiceNo: invoiceNo,
        invoiceDate,
        notes: notes.trim() || undefined,
        items,
        payments: payments.map((p) => ({ method: p.method, amount: p.amount, reference: p.reference || undefined })),
      });
      if (result.ok) {
        router.push(`/purchases/${result.purchaseId}?new=1`);
        return;
      }
      setFailure(result);
    } catch {
      setFailure({ ok: false, code: "UNAVAILABLE", message: "We couldn't reach the server. Nothing was recorded; check your connection and try again." });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-4 pb-44 sm:pb-28"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {failure ? (
        <Alert tone="danger" title="The purchase wasn't recorded" role="alert">
          {failure.line ? `Line ${failure.line}: ` : ""}
          {failure.message}
          {failure.reference ? (
            <span className="mt-1 block text-xs">
              Reference: <span className="font-mono">{failure.reference}</span>
            </span>
          ) : null}
        </Alert>
      ) : null}

      <Card className="grid gap-4 p-4 sm:grid-cols-2">
        <Field label="Supplier" htmlFor="pf-supplier" required>
          <LookupPicker
            label="Supplier"
            placeholder="Search supplier by name or phone"
            selectedLabel={supplier ? supplier.name : null}
            onClear={() => setSupplier(null)}
            items={suppliers.items}
            loading={suppliers.loading}
            failed={suppliers.failed}
            query={supplierQuery}
            onQuery={setSupplierQuery}
            onSelect={setSupplier}
            getKey={(s) => s.id}
            renderItem={(s) => (
              <span className="flex flex-col">
                <span className="font-medium">{s.name}</span>
                {s.phone ? <span className="text-xs text-muted-foreground">{s.phone}</span> : null}
              </span>
            )}
            emptyText="No active supplier matches. Add one on the Suppliers page."
          />
        </Field>
        <Field
          label="Supplier's invoice number"
          htmlFor="pf-invoice"
          required
          error={failure?.field === "supplierInvoiceNo" ? failure.message : undefined}
          hint="Entering the same invoice twice is blocked"
        >
          <Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} maxLength={64} autoComplete="off" />
        </Field>
        <Field label="Invoice date" htmlFor="pf-date" required error={failure?.field === "invoiceDate" ? failure.message : undefined}>
          <Input type="date" value={invoiceDate} max={today} onChange={(e) => setInvoiceDate(e.target.value)} />
        </Field>
        <Field label="Note" htmlFor="pf-notes" hint="Optional">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} rows={2} />
        </Field>
      </Card>

      <section aria-label="Lines" className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Items received</h2>
        {lines.map((l, i) => (
          <LineEditor
            key={l.key}
            index={i}
            line={l}
            problem={checks[i]?.problem ?? null}
            quoted={quote?.lines[i] ?? null}
            canRemove={lines.length > 1}
            onChange={(patch) => patchLine(l.key, patch)}
            onRemove={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}
          />
        ))}
        <div>
          <Button type="button" variant="outline" onClick={() => setLines((prev) => [...prev, blankLine(nextKey("l"))])}>
            <Plus aria-hidden />
            Add line
          </Button>
        </div>
      </section>

      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Paid now</h2>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={quote === null}
              onClick={() => quote && setPayments([{ key: nextKey("p"), method: "CASH", amount: quote.totals.grandTotal, reference: "" }])}
            >
              Paid in full
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setPayments((prev) => [...prev, { key: nextKey("p"), method: "CASH", amount: "", reference: "" }])}>
              <Plus aria-hidden />
              Add payment
            </Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">Whatever you don&rsquo;t pay now stays owed to the supplier and can be paid later from their page.</p>
        {payments.map((p, i) => {
          const c = paymentChecks[i];
          const err = c && !c.success ? c.error.issues[0]?.message : undefined;
          return (
            <div key={p.key} className="grid grid-cols-2 items-start gap-3 sm:grid-cols-[10rem_1fr_1fr_auto]">
              <Field label={`Payment ${i + 1} method`} htmlFor={`pay-${p.key}-method`}>
                <Select value={p.method} onChange={(e) => setPayments((prev) => prev.map((x) => (x.key === p.key ? { ...x, method: e.target.value } : x)))}>
                  {MONEY_PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>{PAYMENT_LABELS[m]}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Amount" htmlFor={`pay-${p.key}-amount`} error={err}>
                <Input inputMode="decimal" value={p.amount} onChange={(e) => setPayments((prev) => prev.map((x) => (x.key === p.key ? { ...x, amount: e.target.value } : x)))} autoComplete="off" />
              </Field>
              {(METHODS_WITH_REFERENCE as readonly string[]).includes(p.method) ? (
                <Field label="Transaction ID" htmlFor={`pay-${p.key}-ref`} hint="Optional">
                  <Input value={p.reference} maxLength={64} onChange={(e) => setPayments((prev) => prev.map((x) => (x.key === p.key ? { ...x, reference: e.target.value } : x)))} autoComplete="off" />
                </Field>
              ) : (
                <div className="hidden sm:block" />
              )}
              <Button type="button" variant="ghost" size="icon" className="mt-6" onClick={() => setPayments((prev) => prev.filter((x) => x.key !== p.key))}>
                <Trash2 aria-hidden />
                <span className="sr-only">Remove payment {i + 1}</span>
              </Button>
            </div>
          );
        })}
        {failure?.field === "payments" ? <p role="alert" className="text-sm text-danger-text">{failure.message}</p> : null}
      </Card>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 px-4 py-3 shadow-md backdrop-blur md:left-16 lg:left-64 print:hidden">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-sm sm:grid-cols-4" aria-live="polite" aria-label="Purchase totals">
            <div className="hidden sm:block">
              <dt className="text-xs text-muted-foreground">Subtotal</dt>
              <dd>{quote ? <MoneyText amount={quote.totals.subtotal} fractionDigits={2} /> : "—"}</dd>
            </div>
            <div className="hidden sm:block">
              <dt className="text-xs text-muted-foreground">Discount / VAT</dt>
              <dd>
                {quote ? (
                  <>
                    −<MoneyText amount={quote.totals.discountTotal} fractionDigits={2} /> / +<MoneyText amount={quote.totals.taxTotal} fractionDigits={2} />
                  </>
                ) : (
                  "—"
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Total</dt>
              <dd className="font-semibold">{quote ? <MoneyText amount={quote.totals.grandTotal} fractionDigits={2} /> : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Owed after paying now</dt>
              <dd className={overpaid ? "font-semibold text-danger-text" : ""}>
                {remaining === null ? "—" : overpaid ? "More than the total" : formatMoney(formatPaisa(remaining), { fractionDigits: 2 })}
              </dd>
            </div>
          </dl>
          <div className="flex flex-col items-end gap-1">
            <Button type="submit" size="lg" disabled={!canSave} loading={submitting}>
              {submitting ? "Recording" : "Record purchase"}
            </Button>
            <p className="max-w-xs text-right text-xs text-muted-foreground" aria-live="polite">
              {supplier === null
                ? "Choose a supplier."
                : !allLinesValid
                  ? "Complete every line to see the total."
                  : quoteState.status === "loading"
                    ? "Pricing…"
                    : quoteState.status === "error"
                      ? quoteState.failure.message
                      : invoiceNo.trim() === ""
                        ? "Enter the supplier's invoice number."
                        : ""}
            </p>
          </div>
        </div>
      </div>
    </form>
  );
}

function LineEditor({
  index, line, problem, quoted, canRemove, onChange, onRemove,
}: {
  index: number;
  line: Line;
  problem: string | null;
  quoted: PurchaseQuoteLine | null;
  canRemove: boolean;
  onChange: (patch: Partial<Line>) => void;
  onRemove: () => void;
}) {
  const id = (name: string) => `line-${line.key}-${name}`;
  const meds = useLookup("/api/purchases/medicines", line.medQuery, pickMedicines, line.medicine === null);
  const med = line.medicine;
  const started = med !== null && (line.batch !== "" || line.qty !== "" || line.price !== "");

  return (
    <Card className="flex flex-col gap-3 p-4" aria-label={`Line ${index + 1}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <Field label={`Line ${index + 1}: medicine`} htmlFor={id("medicine")} required>
            <LookupPicker
              label="Medicine"
              placeholder="Search name, generic, company, barcode or SKU"
              selectedLabel={med ? [med.name, med.strength, med.dosageForm].filter(Boolean).join(" · ") : null}
              onClear={() => onChange({ medicine: null })}
              items={meds.items}
              loading={meds.loading}
              failed={meds.failed}
              query={line.medQuery}
              onQuery={(q) => onChange({ medQuery: q })}
              onSelect={(m) => onChange({ medicine: m })}
              getKey={(m) => m.id}
              renderItem={(m) => (
                <span className="flex flex-col">
                  <span className="font-medium">
                    {m.name} {m.strength ?? ""}
                  </span>
                  <span className="text-xs text-muted-foreground">{[m.genericName, m.dosageForm, m.companyName].filter(Boolean).join(" · ")}</span>
                </span>
              )}
              emptyText="No medicine matches."
            />
          </Field>
        </div>
        {canRemove ? (
          <Button type="button" variant="ghost" size="icon" className="mt-6" onClick={onRemove}>
            <Trash2 aria-hidden />
            <span className="sr-only">Remove line {index + 1}</span>
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Batch number" htmlFor={id("batch")} required>
          <Input value={line.batch} maxLength={64} onChange={(e) => onChange({ batch: e.target.value })} autoComplete="off" />
        </Field>
        <Field label="Expiry date" htmlFor={id("expiry")} required>
          <Input type="date" value={line.expiry} onChange={(e) => onChange({ expiry: e.target.value })} />
        </Field>
        <Field label="Units bought" htmlFor={id("qty")}>
          <Input inputMode="numeric" value={line.qty} onChange={(e) => onChange({ qty: e.target.value })} autoComplete="off" />
        </Field>
        <Field label="Free units" htmlFor={id("free")}>
          <Input inputMode="numeric" value={line.free} onChange={(e) => onChange({ free: e.target.value })} autoComplete="off" />
        </Field>
        <Field label={`Price per ${med?.unit ?? "unit"}`} htmlFor={id("price")} required>
          <Input inputMode="decimal" value={line.price} onChange={(e) => onChange({ price: e.target.value })} autoComplete="off" />
        </Field>
        <Field label="Discount" htmlFor={id("dtype")}>
          <Select value={line.dtype} onChange={(e) => onChange({ dtype: e.target.value as DiscountType, dvalue: "" })}>
            <option value="NONE">None</option>
            <option value="PERCENT">Percent (%)</option>
            <option value="AMOUNT">Amount</option>
          </Select>
        </Field>
        <Field label={line.dtype === "PERCENT" ? "Discount %" : "Discount amount"} htmlFor={id("dvalue")}>
          <Input inputMode="decimal" value={line.dvalue} disabled={line.dtype === "NONE"} onChange={(e) => onChange({ dvalue: e.target.value })} autoComplete="off" />
        </Field>
        <Field label="VAT %" htmlFor={id("tax")} hint="Added on top">
          <Input inputMode="decimal" value={line.tax} onChange={(e) => onChange({ tax: e.target.value })} autoComplete="off" />
        </Field>
      </div>

      <details className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
        <summary className="cursor-pointer font-medium">Selling prices for a new batch (optional)</summary>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:max-w-md">
          <Field label="Sale price" htmlFor={id("sale")} hint={med?.defaultSalePrice ? `Default ${formatMoney(med.defaultSalePrice, { fractionDigits: 2 })}` : "No default set"}>
            <Input inputMode="decimal" value={line.sale} onChange={(e) => onChange({ sale: e.target.value })} autoComplete="off" />
          </Field>
          <Field label="MRP" htmlFor={id("mrp")} hint={med?.mrp ? `Default ${formatMoney(med.mrp, { fractionDigits: 2 })}` : "No default set"}>
            <Input inputMode="decimal" value={line.mrp} onChange={(e) => onChange({ mrp: e.target.value })} autoComplete="off" />
          </Field>
          <p className="col-span-2 text-xs text-muted-foreground">
            Used only when this makes a new batch. An existing batch keeps its prices (changing them needs price permission).
          </p>
        </div>
      </details>

      <div className="text-sm" aria-live="polite">
        {quoted ? (
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>
              Line total <span className="font-semibold"><MoneyText amount={quoted.lineTotal} fractionDigits={2} /></span>
            </span>
            <span className="text-muted-foreground">
              Cost per unit incl. free units: <MoneyText amount={quoted.unitCost} fractionDigits={4} />
            </span>
            <span className="text-muted-foreground">{quoted.topsUpBatch ? "Adds to an existing batch" : "Creates a new batch"}</span>
            {quoted.daysToExpiry !== null && quoted.daysToExpiry <= 0 ? (
              <span className="font-medium text-danger-text">Expired or expiring today: it can&rsquo;t be received</span>
            ) : quoted.daysToExpiry !== null && quoted.daysToExpiry <= EXPIRY_NEAR_DAYS ? (
              <span className="font-medium text-warning-text">Expires in {quoted.daysToExpiry} days</span>
            ) : null}
          </p>
        ) : started && problem ? (
          <p className="text-muted-foreground">{problem}</p>
        ) : null}
      </div>
    </Card>
  );
}
