import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, HandCoins, UserRound, Users, Wallet } from "lucide-react";
import { Card } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/common/data-table";
import { MoneyText } from "@/components/common/money-text";
import { PaginationLinks } from "@/components/common/pagination-links";
import { StatCard } from "@/components/common/stat-card";
import { StatusBadge } from "@/components/common/status-badge";
import { CustomerFormDialog } from "@/components/customers/customer-form-dialog";
import { MedicineSearchBox } from "@/components/medicines/medicine-search-box";
import { parsePaisa } from "@/domain/money";
import { formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { CUSTOMER_FILTERS, type CustomerFilter } from "@/lib/validation/customer";
import { getDueSummary, listCustomers, type CustomerRow } from "@/server/db/customers";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Customers" };

const PAGE_SIZE = 25;

const FILTER_LABELS: Record<CustomerFilter, string> = {
  all: "All customers",
  due: "Owe money",
  over_limit: "Over their limit",
  inactive: "Inactive",
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

export default async function CustomersPage({ searchParams }: Props) {
  const session = await requireSession();
  const params = await searchParams;

  const query = first(params.q).trim().slice(0, 100);
  const requested = first(params.filter);
  const filter: CustomerFilter = (CUSTOMER_FILTERS as readonly string[]).includes(requested) ? (requested as CustomerFilter) : "all";
  const parsedPage = Number.parseInt(first(params.page), 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? Math.min(parsedPage, 100000) : 1;

  const [summary, { items, total }] = await Promise.all([
    getDueSummary(session.branch.id),
    listCustomers(session.branch.id, query, filter, page, PAGE_SIZE),
  ]);

  const buildHref = (nextFilter: CustomerFilter, nextPage = 1) => {
    const next = new URLSearchParams();
    if (query) next.set("q", query);
    if (nextFilter !== "all") next.set("filter", nextFilter);
    if (nextPage > 1) next.set("page", String(nextPage));
    const qs = next.toString();
    return qs ? `/customers?${qs}` : "/customers";
  };

  const columns: DataTableColumn<CustomerRow>[] = [
    {
      key: "name",
      header: "Customer",
      cell: (c) => (
        <div className="flex min-w-0 flex-col">
          <span className="flex flex-wrap items-center gap-1.5">
            <Link href={`/customers/${c.id}`} className="font-medium text-foreground hover:text-primary-text hover:underline">
              {c.name}
            </Link>
            {!c.isActive ? <StatusBadge tone="neutral">Inactive</StatusBadge> : null}
          </span>
          <span className="text-xs text-muted-foreground">{c.phone ?? "No phone"}</span>
        </div>
      ),
    },
    {
      key: "balance",
      header: "Balance",
      align: "right",
      cell: (c) => <BalanceCell balance={c.balance} overLimit={c.overLimit} />,
    },
    {
      key: "limit",
      header: "Credit limit",
      align: "right",
      hideOnMobile: true,
      cell: (c) => (c.creditLimit === null ? <span className="text-muted-foreground">No limit</span> : <MoneyText amount={c.creditLimit} fractionDigits={2} />),
    },
    {
      key: "activity",
      header: "Last activity",
      hideOnMobile: true,
      cell: (c) =>
        c.lastActivity ? <span className="whitespace-nowrap">{formatDateTime(c.lastActivity, session.branch.timezone)}</span> : <span className="text-muted-foreground">None yet</span>,
    },
  ];

  const canEdit = session.permissions.includes("customer.edit");

  return (
    <>
      <section aria-label="Summary" className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Link href={buildHref("due")} className="rounded-xl focus-visible:outline-offset-4">
          <StatCard
            label="Total owed to you"
            icon={Wallet}
            tone={summary.customersWithDue > 0 ? "warning" : "neutral"}
            value={<MoneyText amount={summary.totalDue} fractionDigits={2} />}
            caption={summary.advanceTotal !== "0" && summary.advanceTotal !== "0.00" ? "Advances held are not netted off" : "Across all customers"}
            className="h-full transition-colors hover:border-primary"
          />
        </Link>
        <Link href={buildHref("due")} className="rounded-xl focus-visible:outline-offset-4">
          <StatCard
            label="Customers who owe"
            icon={HandCoins}
            tone="primary"
            value={summary.customersWithDue}
            caption="With a balance above 0"
            className="h-full transition-colors hover:border-primary"
          />
        </Link>
        <Link href={buildHref("over_limit")} className="rounded-xl focus-visible:outline-offset-4">
          <StatCard
            label="Over their limit"
            icon={AlertTriangle}
            tone={summary.customersOverLimit > 0 ? "danger" : "neutral"}
            value={summary.customersOverLimit}
            caption="Owe more than their credit limit"
            className="h-full transition-colors hover:border-primary"
          />
        </Link>
        <StatCard label="Active customers" icon={Users} tone="neutral" value={summary.activeCustomers} caption="Can buy at the till" />
      </section>

      <Card>
        <div className="flex flex-col gap-3 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <MedicineSearchBox key={query} initialQuery={query} label="Search customers by name or phone" placeholder="Search name or phone" />
            {canEdit ? <CustomerFormDialog /> : null}
          </div>
          <nav aria-label="Filter customers" className="flex flex-wrap gap-2">
            {CUSTOMER_FILTERS.map((key) => (
              <Link
                key={key}
                href={buildHref(key)}
                aria-current={key === filter ? "true" : undefined}
                className={cn(
                  "inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium transition-colors",
                  key === filter
                    ? "border-primary bg-primary-soft text-primary-text"
                    : "bg-card text-muted-foreground hover:border-primary hover:text-foreground",
                )}
              >
                {FILTER_LABELS[key]}
              </Link>
            ))}
          </nav>
        </div>
        <div className="border-t">
          <DataTable
            caption="Customers and what they owe"
            columns={columns}
            rows={items}
            getRowId={(c) => c.id}
            empty={{
              icon: UserRound,
              title: query ? `Nobody matches “${query}” here` : emptyTitle(filter),
              description: query ? "Try another filter or search term." : emptyDescription(filter, canEdit),
            }}
          />
          {items.length > 0 ? <PaginationLinks page={page} pageSize={PAGE_SIZE} total={total} hrefFor={(p) => buildHref(filter, p)} /> : null}
        </div>
      </Card>
    </>
  );
}

/** Positive = owes, negative = holds an advance. The sign decides the words; the database decided the number and the limit flag. */
function BalanceCell({ balance, overLimit }: { balance: string; overLimit: boolean }) {
  const paisa = parsePaisa(balance.replace(/^-/, ""));
  const nonZero = paisa !== null && paisa > BigInt(0);
  const advance = nonZero && balance.startsWith("-");
  const owes = nonZero && !advance;
  return (
    <span className="flex flex-col items-end">
      <MoneyText
        amount={advance ? balance.slice(1) : balance}
        fractionDigits={2}
        className={cn("font-medium", owes && "text-foreground", overLimit && "text-danger-text")}
      />
      <span className={cn("text-xs", overLimit ? "text-danger-text" : "text-muted-foreground")}>
        {overLimit ? "Over limit" : owes ? "Owes" : advance ? "Advance" : "Clear"}
      </span>
    </span>
  );
}

function emptyTitle(filter: CustomerFilter): string {
  switch (filter) {
    case "due": return "Nobody owes anything";
    case "over_limit": return "Nobody is over their limit";
    case "inactive": return "No inactive customers";
    default: return "No customers yet";
  }
}

function emptyDescription(filter: CustomerFilter, canEdit: boolean): string {
  switch (filter) {
    case "due": return "Customers appear here when they buy on credit and haven't paid it off.";
    case "over_limit": return "Customers appear here when what they owe passes their credit limit.";
    case "inactive": return "Customers you deactivate are listed here. Their history is kept.";
    default: return canEdit ? "Add a customer here, or from the till when you sell." : "Customers are added here or from the till.";
  }
}
