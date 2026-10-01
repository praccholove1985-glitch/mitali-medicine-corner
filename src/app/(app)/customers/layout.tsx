import { Forbidden } from "@/components/common/forbidden";
import { PageHeader } from "@/components/common/page-header";
import { requireSession } from "@/server/session";

export default async function CustomersLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  if (!session.permissions.includes("customer.view")) return <Forbidden section="customers" />;

  return (
    <>
      <PageHeader
        title="Customers"
        description="Who owes what, every payment received, and a statement for any date range."
      />
      {children}
    </>
  );
}
