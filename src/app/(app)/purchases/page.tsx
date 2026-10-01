import type { Metadata } from "next";
import Link from "next/link";
import { Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/common/data-table";
import { MoneyText } from "@/components/common/money-text";
import { StatusBadge } from "@/components/common/status-badge";
import { MedicineSearchBox } from "@/components/medicines/medicine-search-box";
import { parsePaisa } from "@/domain/money";
import { formatDate } from "@/lib/dates";
import { listPurchases, type PurchaseListRow } from "@/server/db/purchases";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Purchases" };

const PAGE_SIZE = 25;

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PurchasesPage({ searchParams }: Props) {
  const session = await requireSession();
  const params = await searchParams;

  const query = first(params.q).trim().slice(0, 100);
  const supplierParam = first(params.supplier);
  const supplierId = UUID.test(supplierParam) ? supplierParam : null;
  const before = Number.parseInt(first(params.before), 10);
  const beforeSeq = Number.isFinite(before) && before > 0 ? before : null;

  const { items, hasMore } = await listPurchases(session.branch.id, { supplierId, query, beforeSeq, limit: PAGE_SIZE });

  const hrefWith = (extra: Record<string, string>, keepSupplier = true) => {
    const next = new URLSearchParams();
    if (query) next.set("q", query);
    if (supplierId && keepSupplier) next.set("supplier", supplierId);
    for (const [k, v] of Object.entries(extra)) next.set(k, v);
    const qs = next.toString();
    return qs ? `/purchases?${qs}` : "/purchases";
  };

  const columns: DataTableColumn<PurchaseListRow>[] = [
    {
      key: "no",
      header: "Purchase",
      cell: (p) => (
        <div className="flex min-w-0 flex-col">
          <Link href={`/purchases/${p.id}`} className="font-medium text-foreground hover:text-primary-text hover:underline">
            {p.purchaseNo}
          </Link>
          <span className="text-xs text-muted-foreground">
            {p.supplierInvoiceNo} · {formatDate(p.invoiceDate)}
          </span>
        </div>
      ),
    },
    {
      key: "supplier",
      header: "Supplier",
      hideOnMobile: true,
      cell: (p) => (
        <Link href={`/suppliers/${p.supplierId}`} className="hover:text-primary-text hover:underline">
          {p.supplierName}
        </Link>
      ),
    },
    { key: "items", header: "Lines", align: "right", hideOnMobile: true, cell: (p) => p.itemCount },
    { key: "total", header: "Total", align: "right", cell: (p) => <MoneyText amount={p.grandTotal} fractionDigits={2} /> },
    {
      key: "due",
      header: "Still owed",
      align: "right",
      cell: (p) => {
        const owed = (parsePaisa(p.dueTotal) ?? BigInt(0)) > BigInt(0);
        return owed ? <MoneyText amount={p.dueTotal} fractionDigits={2} className="font-medium" /> : <StatusBadge tone="success">Paid</StatusBadge>;
      },
    },
  ];

  const canCreate = session.permissions.includes("purchase.create");
  const last = items[items.length - 1];

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <MedicineSearchBox key={query} initialQuery={query} label="Search purchases by number, supplier invoice or supplier" placeholder="Search number, invoice or supplier" />
        {canCreate ? (
          <Button asChild>
            <Link href="/purchases/new">
              <Truck aria-hidden />
              New purchase
            </Link>
          </Button>
        ) : null}
      </div>
      {supplierId ? (
        <p className="border-t px-4 py-2 text-sm text-muted-foreground">
          Showing one supplier&rsquo;s purchases.{" "}
          <Link href={hrefWith({}, false)} className="text-primary-text hover:underline">
            Show all
          </Link>
        </p>
      ) : null}
      <div className="border-t">
        <DataTable
          caption="Purchases, newest first"
          columns={columns}
          rows={items}
          getRowId={(p) => p.id}
          empty={{
            icon: Truck,
            title: query ? `Nothing matches “${query}”` : "No purchases yet",
            description: query ? "Try another search." : canCreate ? "Record the first purchase when stock arrives." : "Purchases appear here once they are recorded.",
          }}
        />
        {items.length > 0 ? (
          <nav aria-label="Pagination" className="flex items-center justify-between gap-3 border-t px-4 py-3">
            <p className="text-xs text-muted-foreground">Showing the {beforeSeq ? "next" : "latest"} {items.length}</p>
            <div className="flex gap-2">
              {beforeSeq ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={hrefWith({})}>Back to newest</Link>
                </Button>
              ) : null}
              {hasMore && last ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={hrefWith({ before: String(last.purchaseSeq) })}>Older</Link>
                </Button>
              ) : null}
            </div>
          </nav>
        ) : null}
      </div>
    </Card>
  );
}
