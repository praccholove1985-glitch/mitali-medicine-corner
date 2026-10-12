import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarClock, Receipt, Truck, Wallet } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MoneyText } from "@/components/common/money-text";
import { StatCard } from "@/components/common/stat-card";
import { StatusBadge } from "@/components/common/status-badge";
import { PrintButton } from "@/components/pos/print-button";
import { PaySupplierDialog } from "@/components/suppliers/pay-supplier-dialog";
import { SupplierActiveButton } from "@/components/suppliers/supplier-active-button";
import { SupplierFormDialog } from "@/components/suppliers/supplier-form-dialog";
import { SupplierStatementTable } from "@/components/suppliers/supplier-statement-table";
import { parsePaisa } from "@/domain/money";
import { formatDate, formatDateTime, todayInTimezone } from "@/lib/dates";
import { parseStatementRange } from "@/lib/validation/customer";
import { getSupplierStatement, getSupplierSummary } from "@/server/db/suppliers";
import { requireSession } from "@/server/session";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const metadata: Metadata = { title: "Supplier" };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function SupplierPage({ params, searchParams }: Props) {
  const session = await requireSession();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();

  const supplier = await getSupplierSummary(session.branch.id, id);
  if (!supplier) notFound();

  const today = todayInTimezone(session.branch.timezone);
  const range = parseStatementRange(first(query.from), first(query.to), { from: `${today.slice(0, 8)}01`, to: today });
  const statement = await getSupplierStatement(session.branch.id, id, range.from, range.to);

  const tz = session.branch.timezone;
  const balancePaisa = parsePaisa(supplier.balance.replace(/^-/, ""));
  const nonZero = balancePaisa !== null && balancePaisa > BigInt(0);
  const advance = nonZero && supplier.balance.startsWith("-");
  const owes = nonZero && !advance;
  const canViewPurchases = supplier.purchasesCount !== null;

  return (
    <>
      <div className="mb-4 print:hidden">
        <Link href="/suppliers" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden />
          All suppliers
        </Link>
      </div>

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight">
            {supplier.name}
            {!supplier.isActive ? <StatusBadge tone="neutral">Inactive</StatusBadge> : null}
          </h2>
          <p className="text-sm text-muted-foreground">
            {[supplier.contactPerson, supplier.phone, supplier.address].filter(Boolean).join(" · ") || "No contact details recorded"}
          </p>
          <p className="text-xs text-muted-foreground">Added {formatDateTime(supplier.createdAt, tz)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          {supplier.canPurchase && supplier.isActive ? (
            <Button asChild>
              <Link href={`/purchases/new?supplier=${supplier.id}`}>
                <Truck aria-hidden />
                New purchase
              </Link>
            </Button>
          ) : null}
          {supplier.canPay && owes ? (
            <PaySupplierDialog supplierId={supplier.id} supplierName={supplier.name} due={supplier.balance} requestId={randomUUID()} />
          ) : null}
          {supplier.canEdit ? (
            <SupplierFormDialog
              supplier={{ id: supplier.id, name: supplier.name, contactPerson: supplier.contactPerson, phone: supplier.phone, address: supplier.address }}
            />
          ) : null}
          {supplier.canEdit ? <SupplierActiveButton supplierId={supplier.id} isActive={supplier.isActive} /> : null}
        </div>
      </div>

      {!supplier.isActive ? (
        <Alert tone="info" title="This supplier is inactive" className="mb-4 print:hidden">
          They aren&rsquo;t offered for new purchases. The ledger is kept{owes ? ", and you can still pay what you owe" : ""}.
        </Alert>
      ) : null}

      <section aria-label="Account" className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4 print:hidden">
        <StatCard
          label={advance ? "Advance paid" : "You owe"}
          icon={Wallet}
          tone={owes ? "warning" : advance ? "success" : "neutral"}
          value={<MoneyText amount={advance ? supplier.balance.slice(1) : supplier.balance} fractionDigits={2} />}
          caption={owes ? "Still to pay" : advance ? "Paid ahead" : "Nothing owed"}
        />
        <StatCard
          label="Bought so far"
          icon={Receipt}
          tone="primary"
          value={supplier.purchasesTotal === null ? null : <MoneyText amount={supplier.purchasesTotal} fractionDigits={2} />}
          pendingNote="Needs access to purchase costs"
          caption={supplier.purchasesCount === null ? undefined : `${supplier.purchasesCount} purchase${supplier.purchasesCount === 1 ? "" : "s"}`}
        />
        <StatCard
          label="Last purchase"
          icon={Truck}
          tone="neutral"
          value={supplier.lastPurchaseAt ? formatDateTime(supplier.lastPurchaseAt, tz) : canViewPurchases ? "None yet" : null}
          pendingNote="Needs access to purchase costs"
        />
        <StatCard
          label="Last payment"
          icon={CalendarClock}
          tone="neutral"
          value={supplier.lastPaymentAt ? formatDateTime(supplier.lastPaymentAt, tz) : "None yet"}
          caption={canViewPurchases ? undefined : undefined}
        />
      </section>

      {canViewPurchases ? (
        <p className="mb-4 text-sm print:hidden">
          <Link href={`/purchases?supplier=${supplier.id}`} className="text-primary-text hover:underline">
            See this supplier&rsquo;s purchases
          </Link>
        </p>
      ) : null}

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
              {session.branch.name} · {supplier.name} · {formatDate(range.from)} to {formatDate(range.to)}
            </p>
          </div>
          {statement.truncated ? (
            <Alert tone="warning" title="Too many entries to show" className="mb-3">
              This period has {statement.entryCount} entries, so only the first 1,000 are listed. The opening and closing balances are complete; choose a shorter period to see every line.
            </Alert>
          ) : null}
          <SupplierStatementTable statement={statement} timezone={tz} linkInvoices={canViewPurchases} />
        </div>
      </Card>
    </>
  );
}
