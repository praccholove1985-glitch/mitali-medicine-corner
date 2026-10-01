import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Boxes } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/common/empty-state";
import { Forbidden } from "@/components/common/forbidden";
import { MoneyText } from "@/components/common/money-text";
import { PageHeader } from "@/components/common/page-header";
import { ExpiryBadge, StatusBadge } from "@/components/common/status-badge";
import { AddBatchDialog, EditBatchPricesDialog } from "@/components/medicines/batch-dialogs";
import { MedicineForm } from "@/components/medicines/medicine-form";
import { formatDate, nextDay, todayInTimezone } from "@/lib/dates";
import { getCatalogue, getDefaultCost, getMedicine, listBatches } from "@/server/db/medicines";
import { requireSession } from "@/server/session";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  await params;
  return { title: "Medicine" };
}

export default async function MedicineDetailPage({ params, searchParams }: Props) {
  const session = await requireSession();
  if (!session.permissions.includes("medicine.view")) return <Forbidden section="medicines" />;

  const [{ id }, query] = await Promise.all([params, searchParams]);
  const medicine = await getMedicine(id);
  if (!medicine) notFound();

  const can = (code: string) => session.permissions.includes(code);
  const canEdit = can("medicine.edit");
  const canEditPrice = can("price.edit");
  const canSeeCost = can("purchase.view_cost");
  const canSeeStock = can("stock.view");
  const canAddBatch = can("batch.edit") && can("stock.adjust");

  const [catalogue, batches, defaultCost] = await Promise.all([
    getCatalogue(),
    canSeeStock ? listBatches(session.branch.id, medicine.id) : Promise.resolve(null),
    canEditPrice && canSeeCost ? getDefaultCost(medicine.id) : Promise.resolve(null),
  ]);

  const saved = (Array.isArray(query.saved) ? query.saved[0] : query.saved) === "1";
  const sellable = batches?.filter((b) => !b.isExpired).reduce((sum, b) => sum + b.quantity, 0) ?? null;
  const minExpiry = nextDay(todayInTimezone(session.branch.timezone));
  const showCost = batches?.some((b) => b.purchasePrice !== null) ?? false;

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
        <Link href="/medicines">
          <ArrowLeft aria-hidden />
          All medicines
        </Link>
      </Button>
      <PageHeader
        eyebrow="Medicine"
        title={medicine.name}
        description={[medicine.genericName, medicine.strength, medicine.dosageForm].filter(Boolean).join(" · ") || undefined}
        actions={!medicine.isActive ? <StatusBadge tone="neutral">Retired</StatusBadge> : null}
      />

      {saved ? (
        <Alert tone="success" title="Saved" className="mb-4">
          The medicine was saved.
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div>
          {canEdit ? (
            <MedicineForm
              medicine={medicine}
              catalogue={catalogue}
              canEditPrice={canEditPrice}
              purchasePrice={canEditPrice && canSeeCost ? { editable: true, value: defaultCost } : null}
            />
          ) : (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Details</CardTitle>
                  <CardDescription>You can view this medicine but not change it.</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                  <dt className="text-muted-foreground">Barcode</dt>
                  <dd>{medicine.barcode ?? "—"}</dd>
                  <dt className="text-muted-foreground">SKU</dt>
                  <dd>{medicine.sku ?? "—"}</dd>
                  <dt className="text-muted-foreground">MRP</dt>
                  <dd><MoneyText amount={medicine.mrp} fractionDigits={2} /></dd>
                  <dt className="text-muted-foreground">Sale price</dt>
                  <dd>{medicine.salePrice === null ? "Not set" : <MoneyText amount={medicine.salePrice} fractionDigits={2} />}</dd>
                  <dt className="text-muted-foreground">Prescription</dt>
                  <dd>{medicine.prescriptionRequired ? "Required" : "Not required"}</dd>
                </dl>
              </CardContent>
            </Card>
          )}
        </div>

        {batches !== null ? (
          <Card className="h-fit">
            <CardHeader>
              <div>
                <CardTitle>Batches</CardTitle>
                <CardDescription>
                  Earliest expiry first, the order they are sold in
                  {sellable !== null ? ` · ${sellable} unit${sellable === 1 ? "" : "s"} sellable` : ""}
                </CardDescription>
              </div>
              {canAddBatch && medicine.isActive ? (
                <AddBatchDialog
                  medicineId={medicine.id}
                  medicineName={medicine.name}
                  minExpiry={minExpiry}
                  defaultSalePrice={medicine.salePrice}
                  defaultMrp={medicine.mrp}
                />
              ) : null}
            </CardHeader>
            {batches.length === 0 ? (
              <EmptyState
                icon={Boxes}
                title="No batches yet"
                description={
                  canAddBatch
                    ? "Add the stock you have on the shelf. Each batch needs its own expiry date and cost."
                    : "Stock is added as batches, with an expiry date and cost for each."
                }
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Batch</TableHead>
                    <TableHead>Expiry</TableHead>
                    <TableHead align="right">Qty</TableHead>
                    <TableHead align="right">Sale</TableHead>
                    {showCost ? <TableHead align="right">Cost</TableHead> : null}
                    {canEditPrice ? <TableHead align="right"><span className="sr-only">Actions</span></TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {batches.map((b) => (
                    <TableRow key={b.id} className={b.isExpired ? "bg-danger-soft/40" : undefined}>
                      <TableCell className="font-mono text-xs">{b.batchNumber}</TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1">
                          <span className="whitespace-nowrap">{formatDate(b.expiryDate)}</span>
                          <ExpiryBadge daysToExpiry={b.daysToExpiry} />
                        </div>
                      </TableCell>
                      <TableCell align="right">{b.quantity}</TableCell>
                      <TableCell align="right"><MoneyText amount={b.salePrice} fractionDigits={2} /></TableCell>
                      {showCost ? (
                        <TableCell align="right"><MoneyText amount={b.purchasePrice} fractionDigits={2} /></TableCell>
                      ) : null}
                      {canEditPrice ? (
                        <TableCell align="right">
                          <EditBatchPricesDialog
                            medicineId={medicine.id}
                            batchId={b.id}
                            batchNumber={b.batchNumber}
                            salePrice={b.salePrice}
                            mrp={b.mrp}
                          />
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        ) : null}
      </div>
    </>
  );
}
