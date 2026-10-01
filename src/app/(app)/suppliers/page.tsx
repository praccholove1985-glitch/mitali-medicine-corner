import type { Metadata } from "next";
import Link from "next/link";
import { Building2, HandCoins, Truck, Wallet } from "lucide-react";
import { Card } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/common/data-table";
import { MoneyText } from "@/components/common/money-text";
import { PaginationLinks } from "@/components/common/pagination-links";
import { StatCard } from "@/components/common/stat-card";
import { StatusBadge } from "@/components/common/status-badge";
import { MedicineSearchBox } from "@/components/medicines/medicine-search-box";
import { SupplierFormDialog } from "@/components/suppliers/supplier-form-dialog";
import { parsePaisa } from "@/domain/money";
import { formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { SUPPLIER_FILTERS, type SupplierFilter } from "@/lib/validation/supplier";
import { getSupplierDueSummary, listSuppliers, type SupplierRow } from "@/server/db/suppliers";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Suppliers" };

const PAGE_SIZE = 25;

const FILTER_LABELS: Record<SupplierFilter, string> = {
  all: "All suppliers",
  due: "You owe them",
  inactive: "Inactive",
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

export default async function SuppliersPage({ searchParams }: Props) {
  const session = await requireSession();
  const params = await searchParams;

  const query = first(params.q).trim().slice(0, 100);
  const requested = first(params.filter);
  const filter: SupplierFilter = (SUPPLIER_FILTERS as readonly string[]).includes(requested) ? (requested as SupplierFilter) : "all";
  const parsedPage = Number.parseInt(first(params.page), 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? Math.min(parsedPage, 100000) : 1;

  const [summary, { items, total }] = await Promise.all([
    getSupplierDueSummary(session.branch.id),
    listSuppliers(session.branch.id, query, filter, page, PAGE_SIZE),
  ]);

  const buildHref = (nextFilter: SupplierFilter, nextPage = 1) => {
    const next = new URLSearchParams();
    if (query) next.set("q", query);
    if (nextFilter !== "all") next.set("filter", nextFilter);
    if (nextPage > 1) next.set("page", String(nextPage));
    const qs = next.toString();
    return qs ? `/suppliers?${qs}` : "/suppliers";
  };

  const columns: DataTableColumn<SupplierRow>[] = [
    {
      key: "name",
      header: "Supplier",
      cell: (s) => (
        <div className="flex min-w-0 flex-col">
          <span className="flex flex-wrap items-center gap-1.5">
            <Link href={`/suppliers/${s.id}`} className="font-medium text-foreground hover:text-primary-text hover:underline">
              {s.name}
            </Link>
            {!s.isActive ? <StatusBadge tone="neutral">Inactive</StatusBadge> : null}
          </span>
          <span className="text-xs text-muted-foreground">{[s.contactPerson, s.phone].filter(Boolean).join(" · ") || "No contact recorded"}</span>
        </div>
      ),
    },
    { key: "balance", header: "You owe", align: "right", cell: (s) => <OwedCell balance={s.balance} /> },
    {
      key: "activity",
      header: "Last activity",
      hideOnMobile: true,
      cell: (s) =>
        s.lastActivity ? <span className="whitespace-nowrap">{formatDateTime(s.lastActivity, session.branch.timezone)}</span> : <span className="text-muted-foreground">None yet</span>,
    },
  ];

  const canEdit = session.permissions.includes("supplier.edit");
  const canBuy = session.permissions.includes("purchase.create");

  return (
    <>
      <section aria-label="Summary" className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Link href={buildHref("due")} className="rounded-xl focus-visible:outline-offset-4">
          <StatCard
            label="Total you owe"
            icon={Wallet}
            tone={summary.suppliersWithDue > 0 ? "warning" : "neutral"}
            value={<MoneyText amount={summary.totalPayable} fractionDigits={2} />}
            caption={summary.advanceTotal !== "0" && summary.advanceTotal !== "0.00" ? "Advances paid are not netted off" : "Across all suppliers"}
            className="h-full transition-colors hover:border-primary"
          />
        </Link>
        <Link href={buildHref("due")} className="rounded-xl focus-visible:outline-offset-4">
          <StatCard label="Suppliers you owe" icon={HandCoins} tone="primary" value={summary.suppliersWithDue} caption="With a balance above 0" className="h-full transition-colors hover:border-primary" />
        </Link>
        <StatCard label="Active suppliers" icon={Building2} tone="neutral" value={summary.activeSuppliers} caption="Available for new purchases" />
      </section>

      <Card>
        <div className="flex flex-col gap-3 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <MedicineSearchBox key={query} initialQuery={query} label="Search suppliers by name, contact or phone" placeholder="Search name, contact or phone" />
            <div className="flex flex-wrap gap-2">
              {canBuy ? (
                <Link href="/purchases/new" className="inline-flex h-9 items-center gap-2 rounded-md border bg-card px-3 text-sm font-medium hover:border-primary">
                  <Truck className="size-4" aria-hidden />
                  New purchase
                </Link>
              ) : null}
              {canEdit ? <SupplierFormDialog /> : null}
            </div>
          </div>
          <nav aria-label="Filter suppliers" className="flex flex-wrap gap-2">
            {SUPPLIER_FILTERS.map((key) => (
              <Link
                key={key}
                href={buildHref(key)}
                aria-current={key === filter ? "true" : undefined}
                className={cn(
                  "inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium transition-colors",
                  key === filter ? "border-primary bg-primary-soft text-primary-text" : "bg-card text-muted-foreground hover:border-primary hover:text-foreground",
                )}
              >
                {FILTER_LABELS[key]}
              </Link>
            ))}
          </nav>
        </div>
        <div className="border-t">
          <DataTable
            caption="Suppliers and what you owe them"
            columns={columns}
            rows={items}
            getRowId={(s) => s.id}
            empty={{
              icon: Building2,
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

/** Positive = you owe them, negative = they hold your advance. The database decided the number. */
function OwedCell({ balance }: { balance: string }) {
  const paisa = parsePaisa(balance.replace(/^-/, ""));
  const nonZero = paisa !== null && paisa > BigInt(0);
  const advance = nonZero && balance.startsWith("-");
  const owes = nonZero && !advance;
  return (
    <span className="flex flex-col items-end">
      <MoneyText amount={advance ? balance.slice(1) : balance} fractionDigits={2} className="font-medium" />
      <span className="text-xs text-muted-foreground">{owes ? "You owe" : advance ? "Advance paid" : "Settled"}</span>
    </span>
  );
}

function emptyTitle(filter: SupplierFilter): string {
  switch (filter) {
    case "due": return "You don't owe any supplier";
    case "inactive": return "No inactive suppliers";
    default: return "No suppliers yet";
  }
}

function emptyDescription(filter: SupplierFilter, canEdit: boolean): string {
  switch (filter) {
    case "due": return "Suppliers appear here when a purchase isn't fully paid.";
    case "inactive": return "Suppliers you deactivate are listed here. Their history is kept.";
    default: return canEdit ? "Add the suppliers you buy stock from, then record purchases against them." : "Suppliers are added by someone with access to manage them.";
  }
}
