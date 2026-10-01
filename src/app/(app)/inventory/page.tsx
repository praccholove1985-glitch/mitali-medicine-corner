import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Boxes, CalendarClock, PackageSearch, Pill, Wallet } from "lucide-react";
import { Card } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/common/data-table";
import { MoneyText } from "@/components/common/money-text";
import { PaginationLinks } from "@/components/common/pagination-links";
import { ExpiryBadge, StatusBadge, StockBadge } from "@/components/common/status-badge";
import { StatCard } from "@/components/common/stat-card";
import { MedicineSearchBox } from "@/components/medicines/medicine-search-box";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import {
  getInventorySummary,
  listStock,
  STOCK_FILTERS,
  type StockFilter,
  type StockItem,
} from "@/server/db/inventory";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Stock" };

const PAGE_SIZE = 25;

const FILTER_LABELS: Record<StockFilter, string> = {
  in_stock: "In stock",
  low: "Low stock",
  out: "Out of stock",
  expiring: "Expiring soon",
  expired: "Has expired units",
  all: "All medicines",
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

export default async function StockPage({ searchParams }: Props) {
  const session = await requireSession();
  const params = await searchParams;

  const query = first(params.q).trim().slice(0, 100);
  const requested = first(params.filter);
  const filter: StockFilter = (STOCK_FILTERS as readonly string[]).includes(requested) ? (requested as StockFilter) : "in_stock";
  const parsedPage = Number.parseInt(first(params.page), 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? Math.min(parsedPage, 100000) : 1;

  const [summary, { items, total }] = await Promise.all([
    getInventorySummary(session.branch.id),
    listStock(session.branch.id, query, filter, page, PAGE_SIZE),
  ]);

  const buildHref = (nextFilter: StockFilter, nextPage = 1) => {
    const next = new URLSearchParams();
    if (query) next.set("q", query);
    if (nextFilter !== "in_stock") next.set("filter", nextFilter);
    if (nextPage > 1) next.set("page", String(nextPage));
    const qs = next.toString();
    return qs ? `/inventory?${qs}` : "/inventory";
  };

  const showValue = items.some((i) => i.valueAtCost !== null);

  const columns: DataTableColumn<StockItem>[] = [
    {
      key: "name",
      header: "Medicine",
      cell: (m) => (
        <div className="flex min-w-0 flex-col">
          <span className="flex flex-wrap items-center gap-1.5">
            <Link href={`/medicines/${m.medicineId}`} className="font-medium text-foreground hover:text-primary-text hover:underline">
              {m.name}
            </Link>
            {!m.isActive ? <StatusBadge tone="neutral">Retired</StatusBadge> : null}
          </span>
          <span className="text-xs text-muted-foreground">
            {[m.genericName, m.strength, m.dosageForm, m.companyName].filter(Boolean).join(" · ") || "—"}
          </span>
        </div>
      ),
    },
    {
      key: "sellable",
      header: "Sellable",
      align: "right",
      cell: (m) => (
        <span className="flex items-center justify-end gap-2">
          <span className="font-medium">{m.sellableQty}</span>
          <StockBadge quantity={m.sellableQty} reorderLevel={m.reorderLevel} />
        </span>
      ),
    },
    {
      key: "expired",
      header: "Expired",
      align: "right",
      hideOnMobile: true,
      cell: (m) =>
        m.expiredQty > 0 ? (
          <span className="inline-flex items-center gap-1 font-medium text-danger-text">
            <AlertTriangle className="size-3.5" aria-hidden />
            {m.expiredQty}
          </span>
        ) : (
          <span className="text-muted-foreground">0</span>
        ),
    },
    {
      key: "expiry",
      header: "Next expiry",
      hideOnMobile: true,
      cell: (m) =>
        m.nearestExpiry ? (
          <div className="flex flex-col items-start gap-1">
            <span className="whitespace-nowrap">{formatDate(m.nearestExpiry)}</span>
            <ExpiryBadge daysToExpiry={m.nearestExpiryDays} />
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    { key: "batches", header: "Batches", align: "right", hideOnMobile: true, cell: (m) => m.batchCount },
    ...(showValue
      ? [
          {
            key: "value",
            header: "Value at cost",
            align: "right" as const,
            hideOnMobile: true,
            cell: (m: StockItem) => <MoneyText amount={m.valueAtCost} fractionDigits={2} />,
          },
        ]
      : []),
  ];

  return (
    <>
      <section aria-label="Summary" className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-5">
        <StatCard label="Medicines in stock" icon={Pill} tone="primary" value={summary.stockedMedicines} caption={`${summary.sellableUnits} units sellable`} />
        <Link href={buildHref("low")} className="rounded-xl focus-visible:outline-offset-4">
          <StatCard
            label="Low stock"
            icon={PackageSearch}
            tone="warning"
            value={summary.lowStockCount}
            caption={summary.outOfStockCount > 0 ? `${summary.outOfStockCount} out of stock` : "At or below reorder level"}
            className="h-full transition-colors hover:border-primary"
          />
        </Link>
        <Link href="/inventory/expiry" className="rounded-xl focus-visible:outline-offset-4">
          <StatCard
            label="Expiring in 30 days"
            icon={CalendarClock}
            tone="warning"
            value={summary.expiring30Batches}
            caption="batches with stock"
            className="h-full transition-colors hover:border-primary"
          />
        </Link>
        <Link href="/inventory/expiry?bucket=expired" className="rounded-xl focus-visible:outline-offset-4">
          <StatCard
            label="Expired, still on hand"
            icon={AlertTriangle}
            tone={summary.expiredBatches > 0 ? "danger" : "neutral"}
            value={summary.expiredUnits}
            caption={`units in ${summary.expiredBatches} batch${summary.expiredBatches === 1 ? "" : "es"}`}
            className="h-full transition-colors hover:border-primary"
          />
        </Link>
        {summary.valueAtCost !== null ? (
          <StatCard
            label="Stock value at cost"
            icon={Wallet}
            tone="neutral"
            value={<MoneyText amount={summary.valueAtCost} fractionDigits={2} />}
            caption={
              summary.expiredValueAtCost !== null && summary.expiredValueAtCost !== "0"
                ? "Includes expired stock"
                : "All batches on hand"
            }
          />
        ) : null}
      </section>

      <Card>
        <div className="flex flex-col gap-3 px-4 py-3">
          <MedicineSearchBox key={query} initialQuery={query} />
          <nav aria-label="Filter stock" className="flex flex-wrap gap-2">
            {STOCK_FILTERS.map((key) => (
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
            caption="Stock by medicine"
            columns={columns}
            rows={items}
            getRowId={(m) => m.medicineId}
            empty={{
              icon: Boxes,
              title: query ? `Nothing matches “${query}” here` : emptyTitle(filter),
              description: query ? "Try another filter or search term." : emptyDescription(filter),
            }}
          />
          {items.length > 0 ? (
            <PaginationLinks page={page} pageSize={PAGE_SIZE} total={total} hrefFor={(p) => buildHref(filter, p)} />
          ) : null}
        </div>
      </Card>
    </>
  );
}

function emptyTitle(filter: StockFilter): string {
  switch (filter) {
    case "low": return "Nothing is low on stock";
    case "out": return "Nothing is out of stock";
    case "expiring": return "Nothing is expiring soon";
    case "expired": return "No expired units on hand";
    case "in_stock": return "No stock on the shelf yet";
    default: return "No medicines yet";
  }
}

function emptyDescription(filter: StockFilter): string {
  switch (filter) {
    case "low": return "Medicines appear here when sellable stock falls to their reorder level.";
    case "out": return "Medicines you have stocked before appear here when nothing sellable is left.";
    case "expiring": return "Batches expiring within 90 days appear here, earliest first.";
    case "expired": return "Units past their expiry date appear here until they are written off.";
    case "in_stock": return "Add batches from a medicine's page to record what is on the shelf.";
    default: return "Add medicines to the catalogue to start tracking stock.";
  }
}
