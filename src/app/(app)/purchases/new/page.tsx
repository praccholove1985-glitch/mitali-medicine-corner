import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { Forbidden } from "@/components/common/forbidden";
import { PurchaseForm } from "@/components/purchases/purchase-form";
import { todayInTimezone } from "@/lib/dates";
import { getSupplierSummary } from "@/server/db/suppliers";
import { requireSession } from "@/server/session";
import { createPurchaseAction } from "@/app/(app)/purchases/actions";

export const metadata: Metadata = { title: "New purchase" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function NewPurchasePage({ searchParams }: Props) {
  const session = await requireSession();
  if (!session.permissions.includes("purchase.create")) return <Forbidden section="recording purchases" />;

  const params = await searchParams;
  const raw = Array.isArray(params.supplier) ? params.supplier[0] : params.supplier;

  // A supplier page links here with ?supplier=. If it can't be read or is inactive, start empty.
  let initialSupplier: { id: string; name: string; phone: string | null } | null = null;
  if (raw && UUID.test(raw) && session.permissions.includes("supplier.view")) {
    try {
      const s = await getSupplierSummary(session.branch.id, raw);
      if (s && s.isActive) initialSupplier = { id: s.id, name: s.name, phone: s.phone };
    } catch {
      initialSupplier = null;
    }
  }

  return (
    <PurchaseForm
      requestId={randomUUID()}
      today={todayInTimezone(session.branch.timezone)}
      initialSupplier={initialSupplier}
      createPurchase={createPurchaseAction}
    />
  );
}
