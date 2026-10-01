import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarClock, CreditCard, Receipt, Wallet } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MoneyText } from "@/components/common/money-text";
import { StatCard } from "@/components/common/stat-card";
import { StatusBadge } from "@/components/common/status-badge";
import { CustomerActiveButton } from "@/components/customers/customer-active-button";
import { CustomerFormDialog } from "@/components/customers/customer-form-dialog";
import { ReceivePaymentDialog } from "@/components/customers/receive-payment-dialog";
import { StatementTable } from "@/components/customers/statement-table";
import { PrintButton } from "@/components/pos/print-button";
import { formatMoney, parsePaisa } from "@/domain/money";
import { formatDate, formatDateTime, todayInTimezone } from "@/lib/dates";
import { parseStatementRange } from "@/lib/validation/customer";
import { getCustomerSummary, getStatement } from "@/server/db/customers";
import { requireSession } from "@/server/session";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const metadata: Metadata = { title: "Customer" };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function CustomerPage({ params, searchParams }: Props) {
  const session = await requireSession();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();

  const customer = await getCustomerSummary(session.branch.id, id);
  if (!customer) notFound();

  const today = todayInTimezone(session.branch.timezone);
  const range = parseStatementRange(first(query.from), first(query.to), { from: `${today.slice(0, 8)}01`, to: today });
  const statement = await getStatement(session.branch.id, id, range.from, range.to);

  const tz = session.branch.timezone;
  const balancePaisa = parsePaisa(customer.balance.replace(/^-/, ""));
  const nonZero = balancePaisa !== null && balancePaisa > BigInt(0);
  const advance = nonZero && customer.balance.startsWith("-");
  const owes = nonZero && !advance;
  const canViewInvoices = session.permissions.includes("sale.view_all");

  return (
    <>
      <div className="mb-4 print:hidden">
        <Link href="/customers" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden />
          All customers
        </Link>
      </div>

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight">
            {customer.name}
            {!customer.isActive ? <StatusBadge tone="neutral">Inactive</StatusBadge> : null}
          </h2>
          <p className="text-sm text-muted-foreground">
            {[customer.phone, customer.address].filter(Boolean).join(" · ") || "No phone or address recorded"}
          </p>
          <p className="text-xs text-muted-foreground">Customer since {formatDateTime(customer.createdAt, tz)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          {customer.canReceivePayment && owes ? (
            <ReceivePaymentDialog customerId={customer.id} customerName={customer.name} due={customer.balance} requestId={randomUUID()} />
          ) : null}
          {customer.canEdit ? (
            <CustomerFormDialog
              customer={{ id: customer.id, name: customer.name, phone: customer.phone, address: customer.address, creditLimit: customer.creditLimit }}
            />
          ) : null}
          {customer.canEdit ? <CustomerActiveButton customerId={customer.id} isActive={customer.isActive} /> : null}
        </div>
      </div>

      {!customer.isActive ? (
        <Alert tone="info" title="This customer is inactive" className="mb-4 print:hidden">
          They don&rsquo;t appear at the till. Their ledger is kept{owes ? ", and they can still pay what they owe" : ""}.
        </Alert>
      ) : null}

      <section aria-label="Account" className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4 print:hidden">
        <StatCard
          label={advance ? "Advance held" : "Owes now"}
          icon={Wallet}
          tone={owes ? "warning" : advance ? "success" : "neutral"}
          value={<MoneyText amount={advance ? customer.balance.slice(1) : customer.balance} fractionDigits={2} />}
          caption={owes ? "Still to pay" : advance ? "Paid ahead" : "Nothing owed"}
        />
        <StatCard
          label="Credit limit"
          icon={CreditCard}
          tone="neutral"
          value={customer.creditLimit === null ? "No limit" : <MoneyText amount={customer.creditLimit} fractionDigits={2} />}
          caption={customer.availableCredit === null ? "Credit is not capped" : `${formatMoney(customer.availableCredit, { fractionDigits: 2 }) ?? "—"} still available`}
        />
        <StatCard
          label="Bought so far"
          icon={Receipt}
          tone="primary"
          value={<MoneyText amount={customer.salesTotal} fractionDigits={2} />}
          caption={`${customer.salesCount} sale${customer.salesCount === 1 ? "" : "s"}`}
        />
        <StatCard
          label="Last payment"
          icon={CalendarClock}
          tone="neutral"
          value={customer.lastPaymentAt ? formatDateTime(customer.lastPaymentAt, tz) : "None yet"}
          caption={customer.lastSaleAt ? `Last purchase ${formatDateTime(customer.lastSaleAt, tz)}` : "No purchases yet"}
        />
      </section>

      <Card>
        <div className="flex flex-col gap-3 px-4 py-3 print:hidden sm:flex-row sm:items-end sm:justify-between">
          <form method="get" className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="stmt-from" className="text-sm font-medium">From</label>
              <Input id="stmt-from" name="from" type="date" defaultValue={range.from} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="stmt-to" className="text-sm font-medium">To</label>
              <Input id="stmt-to" name="to" type="date" defaultValue={range.to} required />
            </div>
            <Button type="submit" variant="outline">Show statement</Button>
          </form>
          <PrintButton label="Print statement" />
        </div>

        <div className="border-t px-4 py-3">
          <div className="mb-3">
            <h3 className="text-base font-semibold">Statement</h3>
            <p className="text-sm text-muted-foreground">
              {session.branch.name} · {customer.name}
              {customer.phone ? ` · ${customer.phone}` : ""} · {formatDate(range.from)} to {formatDate(range.to)}
            </p>
          </div>
          {statement.truncated ? (
            <Alert tone="warning" title="Too many entries to show" className="mb-3">
              This period has {statement.entryCount} entries, so only the first 1,000 are listed. The opening and closing balances are complete; choose a shorter period to see every line.
            </Alert>
          ) : null}
          <StatementTable statement={statement} timezone={tz} linkInvoices={canViewInvoices} />
        </div>
      </Card>
    </>
  );
}
