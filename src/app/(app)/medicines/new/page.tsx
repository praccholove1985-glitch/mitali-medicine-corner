import type { Metadata } from "next";
import { Forbidden } from "@/components/common/forbidden";
import { PageHeader } from "@/components/common/page-header";
import { MedicineForm } from "@/components/medicines/medicine-form";
import { getCatalogue } from "@/server/db/medicines";
import { requireSession } from "@/server/session";
import { getLocale } from "@/lib/locale";

export const metadata: Metadata = { title: "Add medicine" };

type NewMedicinePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function NewMedicinePage({ searchParams }: NewMedicinePageProps) {
  const params = await searchParams;
  const rawBarcode = Array.isArray(params.barcode) ? params.barcode[0] : params.barcode;
  const initialBarcode = typeof rawBarcode === "string" ? rawBarcode.trim().slice(0, 64) : "";
  const [session, locale] = await Promise.all([requireSession(), getLocale()]);
  if (!session.permissions.includes("medicine.edit")) return <Forbidden section="adding medicines" />;

  const catalogue = await getCatalogue();
  const canEditPrice = session.permissions.includes("price.edit");
  const canSeeCost = session.permissions.includes("purchase.view_cost");

  return (
    <>
      <PageHeader eyebrow="Medicines" title="Add medicine" description="Add it to the catalogue first, then add its batches with expiry and cost." />
      <div className="max-w-3xl">
        <MedicineForm
          medicine={null}
          initialBarcode={initialBarcode}
          catalogue={catalogue}
          canEditPrice={canEditPrice}
          purchasePrice={canEditPrice && canSeeCost ? { editable: true, value: null } : null}
          locale={locale}
        />
      </div>
    </>
  );
}
