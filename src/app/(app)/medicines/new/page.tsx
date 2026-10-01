import type { Metadata } from "next";
import { Forbidden } from "@/components/common/forbidden";
import { PageHeader } from "@/components/common/page-header";
import { MedicineForm } from "@/components/medicines/medicine-form";
import { getCatalogue } from "@/server/db/medicines";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Add medicine" };

export default async function NewMedicinePage() {
  const session = await requireSession();
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
          catalogue={catalogue}
          canEditPrice={canEditPrice}
          purchasePrice={canEditPrice && canSeeCost ? { editable: true, value: null } : null}
        />
      </div>
    </>
  );
}
