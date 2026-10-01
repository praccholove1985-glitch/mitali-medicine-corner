import { Forbidden } from "@/components/common/forbidden";
import { PageHeader } from "@/components/common/page-header";
import { SectionTabs } from "@/components/common/section-tabs";
import { requireSession } from "@/server/session";

export default async function PosLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const canSell = session.permissions.includes("sale.create");
  const canSeeSales = canSell || session.permissions.includes("sale.view_all");
  if (!canSeeSales) return <Forbidden section="sales" />;

  return (
    <>
      <div className="print:hidden">
        <PageHeader title="Point of sale" description="Scan or search, take payment, print the invoice." className="pb-3" />
        <SectionTabs
          label="Point of sale sections"
          items={[
            ...(canSell ? [{ href: "/pos", label: "Sell" }] : []),
            { href: "/pos/history", label: "Sales history" },
          ]}
        />
      </div>
      {children}
    </>
  );
}
