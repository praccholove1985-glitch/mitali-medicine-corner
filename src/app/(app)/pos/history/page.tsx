import type { Metadata } from "next";
import Link from "next/link";
import { Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataTable, type DataTableColumn } from "@/components/common/data-table";
import { MoneyText } from "@/components/common/money-text";
import { StatusBadge } from "@/components/common/status-badge";
import { formatDateTime } from "@/lib/dates";
import { listSales, type SaleListItem } from "@/server/db/pos";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Sales history" };

const PAGE_SIZE = 25;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

export default async function SalesHistoryPage({ searchParams }: Props) {
  const session = await requireSession();
  const params = await searchParams;

  const query = first(params.q).trim().slice(0, 80);
  const from = DATE.test(first(params.from)) ? first(params.from) : null;
  const to = DATE.test(first(params.to)) ? first(params.to) : null;
  const beforeParsed = Number.parseInt(first(params.before), 10);
  const before = Number.isFinite(beforeParsed) && beforeParsed > 0 ? beforeParsed : null;

  const { items, nextBefore } = await listSales(session.branch.id, { query, from, to, beforeSeq: before }, PAGE_SIZE);
  const seeAll = session.permissions.includes("sale.view_all");
  const showProfit = items.some((s) => s.profitTotal !== null);

  const buildHref = (cursor: number | null) => {
    const next = new URLSearchParams();
    if (query) next.set("q", query);
    if (from) next.set("from", from);
    if (to) next.set("to", to);
    if (cursor) next.set("before", String(cursor));
    const qs = next.toString();
    return qs ? `/pos/history?${qs}` : "/pos/history";
  };

  const columns: DataTableColumn<SaleListItem>[] = [
    {
      key: "invoice",
      header: "Invoice",
      cell: (s) => (
        <Link href={`/pos/invoices/${s.saleId}`} className="font-mono text-xs font-semibold text-primary-text hover:underline">
          {s.invoiceNo}
        </Link>
      ),
    },
    { key: "when", header: "When", cell: (s) => <span className="whitespace-nowrap text-xs">{formatDateTime(s.soldAt, session.branch.timezone)}</span> },
    { key: "customer", header: "Customer", hideOnMobile: true, cell: (s) => s.customerName ?? <span className="text-muted-foreground">Walk-in</span> },
    ...(seeAll ? [{ key: "by", header: "Served by", hideOnMobile: true, cell: (s: SaleListItem) => s.cashierName ?? "—" }] : []),
    { key: "items", header: "Lines", align: "right", hideOnMobile: true, cell: (s) => s.itemCount },
    { key: "total", header: "Total", align: "right", cell: (s) => <MoneyText amount={s.grandTotal} fractionDigits={2} className="font-semibold" /> },
    {
      key: "due",
      header: "Payment",
      cell: (s) =>
        /[1-9]/.test(s.dueTotal) ? (
          <StatusBadge tone="warning">
            Due <MoneyText amount={s.dueTotal} fractionDigits={2} />
          </StatusBadge>
        ) : (
          <StatusBadge tone="success">Paid</StatusBadge>
        ),
    },
    ...(showProfit
      ? [{ key: "profit", header: "Profit", align: "right" as const, hideOnMobile: true, cell: (s: SaleListItem) => <MoneyText amount={s.profitTotal} fractionDigits={2} /> }]
      : []),
  ];

  return (
    <Card>
      <form action="/pos/history" className="flex flex-wrap items-end gap-3 px-4 py-3">
        <div className="flex min-w-48 flex-1 flex-col gap-1.5">
          <Label htmlFor="history-q">Invoice, customer or phone</Label>
          <Input id="history-q" name="q" defaultValue={query} autoComplete="off" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="history-from">From</Label>
          <Input id="history-from" name="from" type="date" defaultValue={from ?? ""} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="history-to">To</Label>
          <Input id="history-to" name="to" type="date" defaultValue={to ?? ""} />
        </div>
        <Button type="submit" variant="outline">
          Filter
        </Button>
        {query || from || to ? (
          <Button asChild variant="ghost">
            <Link href="/pos/history">Clear</Link>
          </Button>
        ) : null}
      </form>
      {!seeAll ? <p className="px-4 pb-3 text-xs text-muted-foreground">Showing the sales you made.</p> : null}
      <div className="border-t">
        <DataTable
          caption="Sales, newest first"
          columns={columns}
          rows={items}
          getRowId={(s) => s.saleId}
          empty={{
            icon: Receipt,
            title: query || from || to ? "No sales match" : "No sales yet",
            description: query || from || to ? "Try a different invoice number, customer or date range." : "Completed sales appear here with their invoices.",
          }}
        />
        {before !== null || nextBefore !== null ? (
          <nav aria-label="Pagination" className="flex items-center justify-between gap-3 border-t px-4 py-3">
            {before !== null ? (
              <Button asChild variant="outline" size="sm">
                <Link href={buildHref(null)}>Back to newest</Link>
              </Button>
            ) : (
              <span />
            )}
            {nextBefore !== null ? (
              <Button asChild variant="outline" size="sm">
                <Link href={buildHref(nextBefore)}>Older sales</Link>
              </Button>
            ) : null}
          </nav>
        ) : null}
      </div>
    </Card>
  );
}
