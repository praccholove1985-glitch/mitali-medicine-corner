import type { Metadata } from "next";
import { Forbidden } from "@/components/common/forbidden";
import { PosTerminal } from "@/components/pos/pos-terminal";
import { requireSession } from "@/server/session";
import { completeSaleAction, deleteDraftAction, saveCustomerAction, saveDraftAction } from "./actions";

export const metadata: Metadata = { title: "Sell" };

export default async function PosPage() {
  const session = await requireSession();
  if (!session.permissions.includes("sale.create")) return <Forbidden section="selling" />;

  return (
    <PosTerminal
      canPickCustomer={session.permissions.includes("customer.view")}
      actions={{
        completeSale: completeSaleAction,
        saveDraft: saveDraftAction,
        deleteDraft: deleteDraftAction,
        saveCustomer: saveCustomerAction,
      }}
    />
  );
}
