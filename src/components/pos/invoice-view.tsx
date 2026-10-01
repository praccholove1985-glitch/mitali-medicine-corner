import { formatDate, formatDateTime } from "@/lib/dates";
import { PAYMENT_LABELS } from "@/lib/validation/sale";
import { formatMoney } from "@/domain/money";
import type { Invoice } from "@/server/db/pos";

function methodLabel(method: string): string {
  return (PAYMENT_LABELS as Record<string, string>)[method] ?? method;
}

/** Customer-facing invoice. Carries no cost or profit. */
export function InvoiceView({ invoice, timezone }: { invoice: Invoice; timezone: string }) {
  const { branch, totals } = invoice;
  const hasDue = Number(totals.dueTotal) > 0;
  return (
    <article
      aria-label={`Invoice ${invoice.invoiceNo}`}
      className="mx-auto w-full max-w-3xl rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm print:max-w-none print:border-0 print:p-0 print:shadow-none"
    >
      <header className="flex flex-col gap-1 border-b border-border pb-4">
        <h1 className="text-xl font-semibold">{branch.name}</h1>
        {branch.address ? <p className="text-muted-foreground">{branch.address}</p> : null}
        {branch.phone ? <p className="text-muted-foreground">Phone: {branch.phone}</p> : null}
        {branch.vatRegistration ? (
          <p className="text-muted-foreground">VAT reg: {branch.vatRegistration}</p>
        ) : null}
      </header>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 border-b border-border py-4">
        <div>
          <dt className="text-muted-foreground">Invoice</dt>
          <dd className="tabular font-medium">{invoice.invoiceNo}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Date</dt>
          <dd>{formatDateTime(invoice.soldAt, timezone)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Customer</dt>
          <dd>
            {invoice.customer
              ? `${invoice.customer.name}${invoice.customer.phone ? ` · ${invoice.customer.phone}` : ""}`
              : "Walk-in customer"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Served by</dt>
          <dd>{invoice.cashier ?? "Not recorded"}</dd>
        </div>
      </dl>

      <table className="mt-4 w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th scope="col" className="py-2 pr-2 font-medium">Item</th>
            <th scope="col" className="py-2 pr-2 text-right font-medium">Qty</th>
            <th scope="col" className="py-2 pr-2 text-right font-medium">Price</th>
            <th scope="col" className="py-2 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {invoice.items.map((item) => (
            <tr key={item.lineNo} className="border-b border-border align-top">
              <td className="py-2 pr-2">
                <div className="font-medium">
                  {item.name}
                  {item.strength ? ` ${item.strength}` : ""}
                </div>
                {item.batches.map((b) => (
                  <div key={`${b.batchNumber}-${b.expiryDate}`} className="text-xs text-muted-foreground">
                    Batch {b.batchNumber} · exp {formatDate(b.expiryDate)} · {b.quantity} × {formatMoney(b.unitPrice)}
                  </div>
                ))}
                {Number(item.discount) > 0 ? (
                  <div className="text-xs text-muted-foreground">Discount −{formatMoney(item.discount)}</div>
                ) : null}
              </td>
              <td className="tabular py-2 pr-2 text-right">
                {item.quantity} {item.unit}
              </td>
              <td className="tabular py-2 pr-2 text-right">
                {item.unitPrice ? formatMoney(item.unitPrice) : "Varies by batch"}
              </td>
              <td className="tabular py-2 text-right">{formatMoney(item.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="mt-4 ml-auto grid max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1">
        <dt className="text-muted-foreground">Subtotal</dt>
        <dd className="tabular text-right">{formatMoney(totals.subtotal)}</dd>
        {Number(totals.discountTotal) > 0 ? (
          <>
            <dt className="text-muted-foreground">Discount</dt>
            <dd className="tabular text-right">−{formatMoney(totals.discountTotal)}</dd>
          </>
        ) : null}
        {Number(totals.taxTotal) > 0 ? (
          <>
            <dt className="text-muted-foreground">VAT included</dt>
            <dd className="tabular text-right">{formatMoney(totals.taxTotal)}</dd>
          </>
        ) : null}
        <dt className="border-t border-border pt-1 font-semibold">Total</dt>
        <dd className="tabular border-t border-border pt-1 text-right font-semibold">
          {formatMoney(totals.grandTotal)}
        </dd>
        {invoice.payments.map((p, i) => (
          <div key={`${p.method}-${i}`} className="col-span-2 grid grid-cols-subgrid">
            <dt className="text-muted-foreground">
              {methodLabel(p.method)}
              {p.reference ? ` (${p.reference})` : ""}
            </dt>
            <dd className="tabular text-right">{formatMoney(p.amount)}</dd>
          </div>
        ))}
        {hasDue ? (
          <>
            <dt className="font-semibold">On credit (still to pay)</dt>
            <dd className="tabular text-right font-semibold">{formatMoney(totals.dueTotal)}</dd>
          </>
        ) : null}
      </dl>

      {invoice.notes ? <p className="mt-4 text-muted-foreground">Note: {invoice.notes}</p> : null}
      {branch.invoiceFooter ? (
        <footer className="mt-6 border-t border-border pt-3 text-center text-muted-foreground">
          {branch.invoiceFooter}
        </footer>
      ) : null}
    </article>
  );
}
