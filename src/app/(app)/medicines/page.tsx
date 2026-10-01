import type { Metadata } from "next";
import Link from "next/link";
import { FolderTree, PackageSearch, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/common/data-table";
import { Forbidden } from "@/components/common/forbidden";
import { MoneyText } from "@/components/common/money-text";
import { PageHeader } from "@/components/common/page-header";
import { PaginationLinks } from "@/components/common/pagination-links";
import { StockBadge } from "@/components/common/status-badge";
import { MedicineSearchBox } from "@/components/medicines/medicine-search-box";
import { searchMedicines, type MedicineListItem } from "@/server/db/medicines";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Medicines" };

const PAGE_SIZE = 25;

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function MedicinesPage({ searchParams }: Props) {
  const session = await requireSession();
  if (!session.permissions.includes("medicine.view")) return <Forbidden section="medicines" />;

  const params = await searchParams;
  const query = first(params.q).trim().slice(0, 100);
  const parsedPage = Number.parseInt(first(params.page), 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? Math.min(parsedPage, 100000) : 1;
  const includeInactive = first(params.inactive) === "1";

  const { items, total } = await searchMedicines(session.branch.id, query, page, PAGE_SIZE, includeInactive);
  const canEdit = session.permissions.includes("medicine.edit");

  const buildHref = (target: number, inactive: boolean) => {
    const next = new URLSearchParams();
    if (query) next.set("q", query);
    if (inactive) next.set("inactive", "1");
    if (target > 1) next.set("page", String(target));
    const qs = next.toString();
    return qs ? `/medicines?${qs}` : "/medicines";
  };
  const hrefFor = (target: number) => buildHref(target, includeInactive);

  const columns: DataTableColumn<MedicineListItem>[] = [
    {
      key: "name",
      header: "Medicine",
      cell: (m) => (
        <div className="flex min-w-0 flex-col">
          <span className="flex flex-wrap items-center gap-1.5">
            <Link href={`/medicines/${m.id}`} className="font-medium text-foreground hover:text-primary-text hover:underline">
              {m.name}
            </Link>
            {m.prescriptionRequired ? <Badge tone="info">Rx</Badge> : null}
            {!m.isActive ? <Badge tone="neutral">Retired</Badge> : null}
          </span>
          <span className="text-xs text-muted-foreground">
            {[m.genericName, m.strength, m.dosageForm].filter(Boolean).join(" · ") || "—"}
          </span>
        </div>
      ),
    },
    { key: "company", header: "Company", hideOnMobile: true, cell: (m) => m.companyName ?? <span className="text-muted-foreground">—</span> },
    { key: "mrp", header: "MRP", align: "right", hideOnMobile: true, cell: (m) => <MoneyText amount={m.mrp} fractionDigits={2} /> },
    {
      key: "price",
      header: "Sale price",
      align: "right",
      cell: (m) =>
        m.salePrice === null ? (
          <span className="text-xs text-muted-foreground">Not set</span>
        ) : (
          <MoneyText amount={m.salePrice} fractionDigits={2} />
        ),
    },
    {
      key: "stock",
      header: "In stock",
      cell: (m) =>
        m.stockOnHand === null ? (
          <span className="text-muted-foreground">
            <span aria-hidden>—</span>
            <span className="sr-only">Not reported</span>
          </span>
        ) : (
          <span className="flex flex-wrap items-center gap-2">
            <span className="tabular font-medium">{m.stockOnHand}</span>
            <StockBadge quantity={m.stockOnHand} reorderLevel={m.reorderLevel} />
          </span>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Medicines"
        description="The catalogue of everything the shop sells. Stock lives in batches, shown on each medicine."
        actions={
          canEdit ? (
            <>
              <Button asChild variant="outline">
                <Link href="/medicines/catalogue">
                  <FolderTree aria-hidden />
                  Companies &amp; categories
                </Link>
              </Button>
              <Button asChild>
                <Link href="/medicines/new">
                  <Plus aria-hidden />
                  Add medicine
                </Link>
              </Button>
            </>
          ) : null
        }
      />

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <MedicineSearchBox key={query} initialQuery={query} />
          <Link
            href={buildHref(1, !includeInactive)}
            className="text-sm font-medium text-primary-text hover:underline"
          >
            {includeInactive ? "Hide retired medicines" : "Show retired medicines"}
          </Link>
        </div>
        <div className="border-t">
          <DataTable
            caption="Medicines"
            columns={columns}
            rows={items}
            getRowId={(m) => m.id}
            empty={
              query
                ? {
                    icon: PackageSearch,
                    title: `No medicines match “${query}”`,
                    description: "Check the spelling, or try the generic name, company, barcode or SKU.",
                  }
                : {
                    icon: PackageSearch,
                    title: "No medicines yet",
                    description: canEdit ? "Add the first medicine to start building the catalogue." : "Nothing has been added to the catalogue yet.",
                    action: canEdit ? (
                      <Button asChild>
                        <Link href="/medicines/new">
                          <Plus aria-hidden />
                          Add medicine
                        </Link>
                      </Button>
                    ) : undefined,
                  }
            }
          />
          {items.length > 0 ? <PaginationLinks page={page} pageSize={PAGE_SIZE} total={total} hrefFor={hrefFor} /> : null}
        </div>
      </Card>
    </>
  );
}
