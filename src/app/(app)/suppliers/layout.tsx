import { Forbidden } from "@/components/common/forbidden";
import { PageHeader } from "@/components/common/page-header";
import { requireSession } from "@/server/session";

export default async function SuppliersLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  if (!session.permissions.includes("supplier.view")) return <Forbidden section="suppliers" />;

  return (
    <>
      <PageHeader
        title="Suppliers"
        description="Who you buy from, what you owe each of them, and every payment you've made."
      />
      {children}
    </>
  );
}
