import { Forbidden } from "@/components/common/forbidden";
import { PageHeader } from "@/components/common/page-header";
import { SectionTabs } from "@/components/common/section-tabs";
import { requireSession } from "@/server/session";

export default async function InventoryLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  if (!session.permissions.includes("stock.view")) return <Forbidden section="inventory" />;

  return (
    <>
      <PageHeader
        title="Inventory"
        description="What is on the shelf, what is about to expire, and every change that got it there."
      />
      <SectionTabs
        label="Inventory sections"
        items={[
          { href: "/inventory", label: "Stock" },
          { href: "/inventory/expiry", label: "Expiry" },
          { href: "/inventory/movements", label: "History" },
        ]}
      />
      {children}
    </>
  );
}
