import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MoneyText } from "@/components/common/money-text";
import { StatusBadge } from "@/components/common/status-badge";
import { PrintButton } from "@/components/pos/print-button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { parsePaisa } from "@/domain/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { PAYMENT_LABELS, type PaymentMethod } from "@/lib/validation/sale";
import { getPurchase } from "@/server/db/purchases";
import { requireSession } from "@/server/session";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const metadata: Metadata = { title: "Purchase" };

export default async function PurchasePage({ params, searchParams }: Props) {
  const session = await requireSession();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();

  const purchase = await getPurchase(id);
  if (!purchase) notFound();

  const justSaved = (Array.isArray(query.new) ? query.new[0] : query.new) === "1";
  const tz = session.branch.timezone;
  const owed = (parsePaisa(purchase.totals.dueTotal) ?? BigInt(0)) > BigInt(0);
  const canBuy = session.permissions.includes("purchase.create");

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 print:hidden">
        <Link href="/purchases" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden />
          All purchases
        </Link>
        {justSaved ? (
          <Alert tone="success" title={`Purchase recorded · ${purchase.purchaseNo}`}>
            The stock is on the shelf and the supplier&rsquo;s ledger is updated.
          </Alert>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {canBuy ? (
            <Button asChild>
              <Link href="/purchases/new">
                <CheckCircle2 aria-hidden />
                New purchase
              </Link>
            </Button>
          ) : null}
          <PrintButton label="Print" />
        </div>
      </div>

      <Card className="p-4 sm:p-6">
        <header className="flex flex-col gap-1 border-b pb-4">
          <h2 className="flex flex-wrap items-center gap-2 text-xl font-semibold">
            {purchase.purchaseNo}
            {owed ? <StatusBadge tone="warning">Part unpaid</StatusBadge> : <StatusBadge tone="success">Paid</StatusBadge>}
          </h2>
          <p className="text-muted-foreground">
            {session.branch.name} · recorded {formatDateTime(purchase.createdAt, tz)}
            {purchase.recordedBy ? ` by ${purchase.recordedBy}` : ""}
          </p>
        </header>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 border-b py-4 sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">Supplier</dt>
            <dd className="font-medium">
              {purchase.supplier ? (
                <Link href={`/suppliers/${purchase.supplier.id}`} className="hover:text-primary-text hover:underline">
                  {purchase.supplier.name}
                </Link>
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Supplier invoice</dt>
            <dd className="font-medium">{purchase.supplierInvoiceNo}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Invoice date</dt>
            <dd>{formatDate(purchase.invoiceDate)}</dd>
          </div>
        </dl>

        <Table className="mt-4">
          <caption className="sr-only">Items on {purchase.purchaseNo}</caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Item</TableHead>
              <TableHead scope="col" className="text-right">Units</TableHead>
              <TableHead scope="col" className="hidden text-right sm:table-cell">Price</TableHead>
              <TableHead scope="col" className="hidden text-right md:table-cell">Cost / unit</TableHead>
              <TableHead scope="col" className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {purchase.items.map((i) => (
              <TableRow key={i.lineNo}>
                <TableCell className="[overflow-wrap:anywhere]">
                  <div className="font-medium">
                    {i.name}
                    {i.strength ? ` ${i.strength}` : ""}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Batch {i.batchNumber} · exp {formatDate(i.expiryDate)} · {i.newBatch ? "new batch" : "added to a batch"}
                    {Number(i.discount) > 0 ? ` · discount −${i.discount}` : ""}
                    {Number(i.taxAmount) > 0 ? ` · VAT ${i.taxRate}% +${i.taxAmount}` : ""}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  {i.quantity}
                  {i.freeQuantity > 0 ? <span className="block text-xs text-muted-foreground">+ {i.freeQuantity} free</span> : null}
                </TableCell>
                <TableCell className="hidden text-right sm:table-cell"><MoneyText amount={i.unitPrice} fractionDigits={2} /></TableCell>
                <TableCell className="hidden text-right md:table-cell"><MoneyText amount={i.unitCost} fractionDigits={4} /></TableCell>
                <TableCell className="text-right"><MoneyText amount={i.lineTotal} fractionDigits={2} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <dl className="mt-4 ml-auto grid max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1">
          <dt className="text-muted-foreground">Subtotal</dt>
          <dd className="tabular text-right"><MoneyText amount={purchase.totals.subtotal} fractionDigits={2} /></dd>
          {Number(purchase.totals.discountTotal) > 0 ? (
            <>
              <dt className="text-muted-foreground">Discount</dt>
              <dd className="tabular text-right">−<MoneyText amount={purchase.totals.discountTotal} fractionDigits={2} /></dd>
            </>
          ) : null}
          {Number(purchase.totals.taxTotal) > 0 ? (
            <>
              <dt className="text-muted-foreground">VAT</dt>
              <dd className="tabular text-right"><MoneyText amount={purchase.totals.taxTotal} fractionDigits={2} /></dd>
            </>
          ) : null}
          <dt className="border-t pt-1 font-semibold">Total</dt>
          <dd className="tabular border-t pt-1 text-right font-semibold"><MoneyText amount={purchase.totals.grandTotal} fractionDigits={2} /></dd>
          {purchase.payments.map((p, i) => (
            <div key={`${p.method}-${i}`} className="col-span-2 grid grid-cols-subgrid">
              <dt className="text-muted-foreground">
                Paid · {PAYMENT_LABELS[p.method as PaymentMethod] ?? p.method}
                {p.reference ? ` (${p.reference})` : ""}
              </dt>
              <dd className="tabular text-right"><MoneyText amount={p.amount} fractionDigits={2} /></dd>
            </div>
          ))}
          {owed ? (
            <>
              <dt className="font-semibold">Still owed</dt>
              <dd className="tabular text-right font-semibold"><MoneyText amount={purchase.totals.dueTotal} fractionDigits={2} /></dd>
            </>
          ) : null}
        </dl>

        {purchase.notes ? <p className="mt-4 text-muted-foreground">Note: {purchase.notes}</p> : null}
      </Card>
    </>
  );
}
