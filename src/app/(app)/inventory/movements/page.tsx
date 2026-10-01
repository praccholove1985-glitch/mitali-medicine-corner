import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/common/data-table";
import { formatDateTime } from "@/lib/dates";
import { isMovementType, MOVEMENT_LABELS, MOVEMENT_TYPES } from "@/lib/movement-types";
import { listMovements, type MovementItem } from "@/server/db/inventory";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Stock history" };

const PAGE_SIZE = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

export default async function MovementsPage({ searchParams }: Props) {
  const session = await requireSession();
  const params = await searchParams;

  const typeParam = first(params.type);
  const type = isMovementType(typeParam) ? typeParam : null;
  const medicineParam = first(params.medicine);
  const medicineId = UUID.test(medicineParam) ? medicineParam : null;
  const beforeParam = Number.parseInt(first(params.before), 10);
  const before = Number.isFinite(beforeParam) && beforeParam > 0 ? beforeParam : null;

  const { items, nextBefore } = await listMovements(session.branch.id, { type, medicineId, before }, PAGE_SIZE);

  const buildHref = (cursor: number | null) => {
    const next = new URLSearchParams();
    if (type) next.set("type", type);
    if (medicineId) next.set("medicine", medicineId);
    if (cursor) next.set("before", String(cursor));
    const qs = next.toString();
    return qs ? `/inventory/movements?${qs}` : "/inventory/movements";
  };

  const columns: DataTableColumn<MovementItem>[] = [
    {
      key: "when",
      header: "When",
      cell: (m) => <span className="whitespace-nowrap text-xs">{formatDateTime(m.createdAt, session.branch.timezone)}</span>,
    },
    {
      key: "medicine",
      header: "Medicine",
      cell: (m) => (
        <div className="flex flex-col">
          <Link href={`/medicines/${m.medicineId}`} className="font-medium text-foreground hover:text-primary-text hover:underline">
            {m.medicineName}
          </Link>
          <span className="font-mono text-xs text-muted-foreground">Batch {m.batchNumber}</span>
        </div>
      ),
    },
    {
      key: "type",
      header: "Type",
      cell: (m) => <Badge tone="neutral">{isMovementType(m.movementType) ? MOVEMENT_LABELS[m.movementType] : m.movementType}</Badge>,
    },
    {
      key: "change",
      header: "Change",
      align: "right",
      cell: (m) =>
        m.quantityDelta > 0 ? (
          <span className="inline-flex items-center gap-1 font-medium text-success-text">
            <ArrowUpRight className="size-3.5" aria-hidden />
            +{m.quantityDelta}
            <span className="sr-only"> units added</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 font-medium text-danger-text">
            <ArrowDownRight className="size-3.5" aria-hidden />
            {m.quantityDelta}
            <span className="sr-only"> units removed</span>
          </span>
        ),
    },
    { key: "reason", header: "Reason", hideOnMobile: true, cell: (m) => m.reason ?? <span className="text-muted-foreground">—</span> },
    { key: "by", header: "By", hideOnMobile: true, cell: (m) => m.userName ?? <span className="text-muted-foreground">—</span> },
  ];

  return (
    <Card>
      <form action="/inventory/movements" className="flex flex-wrap items-end gap-3 px-4 py-3">
        {medicineId ? <input type="hidden" name="medicine" value={medicineId} /> : null}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="movement-type" className="text-sm font-medium">
            Type
          </label>
          <select
            id="movement-type"
            name="type"
            defaultValue={type ?? ""}
            className="h-10 min-w-48 rounded-md border border-input bg-card px-3 pr-8 text-sm"
          >
            <option value="">All changes</option>
            {MOVEMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {MOVEMENT_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="outline">
          Filter
        </Button>
        {medicineId || type ? (
          <Button asChild variant="ghost">
            <Link href="/inventory/movements">Clear filters</Link>
          </Button>
        ) : null}
        {medicineId ? <p className="text-sm text-muted-foreground">Showing one medicine only.</p> : null}
      </form>
      <div className="border-t">
        <DataTable
          caption="Stock movements, newest first"
          columns={columns}
          rows={items}
          getRowId={(m) => String(m.id)}
          empty={{
            icon: History,
            title: "No stock changes yet",
            description: "Every change to stock, from opening stock to adjustments and sales, is listed here with who made it.",
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
                <Link href={buildHref(nextBefore)}>Older changes</Link>
              </Button>
            ) : null}
          </nav>
        ) : null}
      </div>
    </Card>
  );
}
