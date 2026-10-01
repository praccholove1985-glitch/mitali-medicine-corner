import Link from "next/link";
import { MoneyText } from "@/components/common/money-text";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/dates";
import { PAYMENT_LABELS, type PaymentMethod } from "@/lib/validation/sale";
import type { Statement, StatementEntry } from "@/server/db/customers";

const TYPE_LABELS: Record<StatementEntry["type"], string> = {
  SALE_DUE: "Sale on credit",
  PAYMENT: "Payment received",
  RETURN_CREDIT: "Return credit",
  OPENING_BALANCE: "Opening balance",
  ADJUSTMENT: "Adjustment",
};

/** Positive amounts add to what is owed (charges); negative ones reduce it. Strings in, strings out. */
const magnitude = (amount: string) => (amount.startsWith("-") ? amount.slice(1) : amount);

function Description({ entry, linkInvoice }: { entry: StatementEntry; linkInvoice: boolean }) {
  const method = entry.method ? (PAYMENT_LABELS[entry.method as PaymentMethod] ?? entry.method) : null;
  return (
    <div className="flex min-w-0 flex-col [overflow-wrap:anywhere]">
      <span className="font-medium">
        {TYPE_LABELS[entry.type]}
        {entry.invoiceNo ? (
          <>
            {" · "}
            {linkInvoice && entry.saleId ? (
              <Link href={`/pos/invoices/${entry.saleId}`} className="text-primary-text hover:underline">
                {entry.invoiceNo}
              </Link>
            ) : (
              entry.invoiceNo
            )}
          </>
        ) : null}
        {method ? ` · ${method}` : ""}
      </span>
      {entry.reference || entry.note || entry.by ? (
        <span className="text-xs text-muted-foreground">
          {[entry.reference ? `Ref ${entry.reference}` : null, entry.note, entry.by ? `by ${entry.by}` : null].filter(Boolean).join(" · ")}
        </span>
      ) : null}
    </div>
  );
}

const WIDE = "hidden sm:table-cell";
const NARROW = "sm:hidden";

/**
 * Opening balance, every entry with the balance after it, then the closing balance. All figures come
 * from the database. Phones get one combined amount-and-balance column instead of three that scroll away.
 */
export function StatementTable({ statement, timezone, linkInvoices }: { statement: Statement; timezone: string; linkInvoices: boolean }) {
  return (
    <Table>
      <caption className="sr-only">
        Statement from {statement.from} to {statement.to}
      </caption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Date</TableHead>
          <TableHead scope="col">Details</TableHead>
          <TableHead scope="col" className={`${WIDE} text-right`}>Charged</TableHead>
          <TableHead scope="col" className={`${WIDE} text-right`}>Paid / credited</TableHead>
          <TableHead scope="col" className={`${WIDE} text-right`}>Balance</TableHead>
          <TableHead scope="col" className={`${NARROW} text-right`}>Amount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow className="bg-muted/50">
          <TableCell colSpan={2} className="font-medium">
            Balance brought forward
          </TableCell>
          <TableCell colSpan={2} className={WIDE} />
          <TableCell className={`${WIDE} text-right font-medium`}>
            <MoneyText amount={statement.opening} fractionDigits={2} />
          </TableCell>
          <TableCell className={`${NARROW} text-right font-medium`}>
            <MoneyText amount={statement.opening} fractionDigits={2} />
          </TableCell>
        </TableRow>
        {statement.entries.length === 0 ? (
          <TableRow>
            <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
              Nothing was charged or paid in this period.
            </TableCell>
          </TableRow>
        ) : (
          statement.entries.map((e) => {
            const charge = !e.amount.startsWith("-");
            return (
              <TableRow key={e.id}>
                <TableCell className="sm:whitespace-nowrap">{formatDateTime(e.at, timezone)}</TableCell>
                <TableCell>
                  <Description entry={e} linkInvoice={linkInvoices} />
                </TableCell>
                <TableCell className={`${WIDE} text-right`}>{charge ? <MoneyText amount={e.amount} fractionDigits={2} /> : null}</TableCell>
                <TableCell className={`${WIDE} text-right`}>{charge ? null : <MoneyText amount={magnitude(e.amount)} fractionDigits={2} />}</TableCell>
                <TableCell className={`${WIDE} text-right`}>
                  <MoneyText amount={e.running} fractionDigits={2} />
                </TableCell>
                <TableCell className={`${NARROW} text-right`}>
                  <div className="flex flex-col items-end">
                    <span className={charge ? "" : "text-success-text"}>
                      {charge ? "+" : "−"}
                      <MoneyText amount={magnitude(e.amount)} fractionDigits={2} />
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Balance <MoneyText amount={e.running} fractionDigits={2} />
                    </span>
                  </div>
                </TableCell>
              </TableRow>
            );
          })
        )}
        <TableRow className="bg-muted/50">
          <TableCell colSpan={2} className="font-semibold">
            Closing balance
          </TableCell>
          <TableCell className={`${WIDE} text-right font-semibold`}>
            <MoneyText amount={statement.totalCharges} fractionDigits={2} />
          </TableCell>
          <TableCell className={`${WIDE} text-right font-semibold`}>
            <MoneyText amount={statement.totalCredits} fractionDigits={2} />
          </TableCell>
          <TableCell className={`${WIDE} text-right font-semibold`}>
            <MoneyText amount={statement.closing} fractionDigits={2} />
          </TableCell>
          <TableCell className={`${NARROW} text-right font-semibold`}>
            <MoneyText amount={statement.closing} fractionDigits={2} />
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}
