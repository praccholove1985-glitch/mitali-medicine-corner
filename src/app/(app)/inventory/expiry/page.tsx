import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/common/data-table";
import { MoneyText } from "@/components/common/money-text";
import { PaginationLinks } from "@/components/common/pagination-links";
import { ExpiryBadge } from "@/components/common/status-badge";
import { WriteOffDialog } from "@/components/inventory/write-off-dialog";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import {
  EXPIRY_BUCKET_FILTERS,
  getExpiryBuckets,
  listExpiry,
  type ExpiryBucketFilter,
  type ExpiryItem,
} from "@/server/db/inventory";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Expiry" };

const PAGE_SIZE = 25;

const BUCKET_LABELS: Record<ExpiryBucketFilter, string> = {
  all: "All (expired + 90 days)",
  expired: "Expired",
  d30: "Within 30 days",
  d60: "31–60 days",
  d90: "61–90 days",
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

export default async function ExpiryPage({ searchParams }: Props) {
  const session = await requireSession();
  const params = await searchParams;

  const requested = first(params.bucket);
  const bucket: ExpiryBucketFilter = (EXPIRY_BUCKET_FILTERS as readonly string[]).includes(requested)
    ? (requested as ExpiryBucketFilter)
    : "all";
  const parsedPage = Number.parseInt(first(params.page), 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? Math.min(parsedPage, 100000) : 1;

  const [buckets, { items, total }] = await Promise.all([
    getExpiryBuckets(session.branch.id),
    listExpiry(session.branch.id, bucket, page, PAGE_SIZE),
  ]);

  const stat = (key: "expired" | "d30" | "d60" | "d90") => buckets.find((b) => b.bucket === key);
  const countFor = (key: ExpiryBucketFilter) =>
    key === "all"
      ? buckets.reduce((sum, b) => sum + b.batches, 0)
      : (stat(key)?.batches ?? 0);

  const buildHref = (nextBucket: ExpiryBucketFilter, nextPage = 1) => {
    const next = new URLSearchParams();
    if (nextBucket !== "all") next.set("bucket", nextBucket);
    if (nextPage > 1) next.set("page", String(nextPage));
    const qs = next.toString();
    return qs ? `/inventory/expiry?${qs}` : "/inventory/expiry";
  };

  const canWriteOff = session.permissions.includes("stock.adjust");
  const expiredOnPage = items.filter((i) => i.daysToExpiry <= 0);
  const showValue = items.some((i) => i.valueAtCost !== null);

  const columns: DataTableColumn<ExpiryItem>[] = [
    {
      key: "medicine",
      header: "Medicine",
      cell: (i) => (
        <div className="flex flex-col">
          <Link href={`/medicines/${i.medicineId}`} className="font-medium text-foreground hover:text-primary-text hover:underline">
            {i.medicineName}
          </Link>
          {i.strength ? <span className="text-xs text-muted-foreground">{i.strength}</span> : null}
        </div>
      ),
    },
    { key: "batch", header: "Batch", cell: (i) => <span className="font-mono text-xs">{i.batchNumber}</span> },
    {
      key: "expiry",
      header: "Expiry",
      cell: (i) => (
        <div className="flex flex-col items-start gap-1">
          <span className="whitespace-nowrap">{formatDate(i.expiryDate)}</span>
          <ExpiryBadge daysToExpiry={i.daysToExpiry} />
        </div>
      ),
    },
    { key: "qty", header: "Units", align: "right", cell: (i) => i.quantity },
    ...(showValue
      ? [
          {
            key: "value",
            header: "Value at cost",
            align: "right" as const,
            hideOnMobile: true,
            cell: (i: ExpiryItem) => <MoneyText amount={i.valueAtCost} fractionDigits={2} />,
          },
        ]
      : []),
  ];

  return (
    <Card>
      <div className="flex flex-col gap-3 px-4 py-3">
        <nav aria-label="Expiry window" className="flex flex-wrap gap-2">
          {EXPIRY_BUCKET_FILTERS.map((key) => (
            <Link
              key={key}
              href={buildHref(key)}
              aria-current={key === bucket ? "true" : undefined}
              className={cn(
                "inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-medium transition-colors",
                key === bucket
                  ? "border-primary bg-primary-soft text-primary-text"
                  : "bg-card text-muted-foreground hover:border-primary hover:text-foreground",
              )}
            >
              {BUCKET_LABELS[key]}
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-foreground">{countFor(key)}</span>
            </Link>
          ))}
        </nav>
        {canWriteOff && expiredOnPage.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-danger/40 bg-danger-soft px-3 py-2">
            <p className="text-sm text-danger-text">
              Expired stock can&rsquo;t be sold. Write it off to take it out of your stock count.
            </p>
            <WriteOffDialog
              batchIds={expiredOnPage.map((i) => i.batchId)}
              units={expiredOnPage.reduce((sum, i) => sum + i.quantity, 0)}
            />
          </div>
        ) : null}
      </div>
      <div className="border-t">
        <DataTable
          caption="Batches by expiry"
          columns={columns}
          rows={items}
          getRowId={(i) => i.batchId}
          empty={{
            icon: CalendarClock,
            title: bucket === "expired" ? "No expired stock on hand" : "Nothing expiring in this window",
            description: "Batches with stock appear here, earliest expiry first.",
          }}
        />
        {items.length > 0 ? (
          <PaginationLinks page={page} pageSize={PAGE_SIZE} total={total} hrefFor={(p) => buildHref(bucket, p)} />
        ) : null}
      </div>
    </Card>
  );
}
