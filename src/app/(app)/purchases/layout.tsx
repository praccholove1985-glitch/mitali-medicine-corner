import { Forbidden } from "@/components/common/forbidden";
import { PageHeader } from "@/components/common/page-header";
import { requireSession } from "@/server/session";

export default async function PurchasesLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  // Purchases are made of supplier prices, so reading them needs the cost permission as well.
  if (!session.permissions.includes("purchase.view") || !session.permissions.includes("purchase.view_cost")) {
    return <Forbidden section="purchases" />;
  }

  return (
    <>
      <PageHeader title="Purchases" description="Stock received from suppliers, what it cost, and what is still owed." />
      {children}
    </>
  );
}
