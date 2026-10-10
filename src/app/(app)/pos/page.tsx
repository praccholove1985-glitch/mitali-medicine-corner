import type { Metadata } from "next";
import { Forbidden } from "@/components/common/forbidden";
import { PosTerminal } from "@/components/pos/pos-terminal";
import { requireSession } from "@/server/session";
import { getLocale } from "@/lib/locale";
import { completeSaleAction, deleteDraftAction, saveCustomerAction, saveDraftAction } from "./actions";

export const metadata: Metadata = { title: "Sell" };

export default async function PosPage() {
  const [session, locale] = await Promise.all([requireSession(), getLocale()]);
  if (!session.permissions.includes("sale.create")) return <Forbidden section="selling" />;

  return (
    <PosTerminal
      locale={locale}
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
