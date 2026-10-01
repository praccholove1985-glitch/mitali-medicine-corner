import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, History } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { InvoiceView } from "@/components/pos/invoice-view";
import { PrintButton } from "@/components/pos/print-button";
import { getInvoice } from "@/server/db/pos";
import { requireSession } from "@/server/session";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const metadata: Metadata = { title: "Invoice" };

export default async function InvoicePage({ params, searchParams }: Props) {
  const session = await requireSession();
  const [{ id }, query] = await Promise.all([params, searchParams]);

  const invoice = await getInvoice(id);
  if (!invoice) notFound();
  const justSold = (Array.isArray(query.new) ? query.new[0] : query.new) === "1";

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 print:hidden">
        {justSold ? (
          <Alert tone="success" title={`Sale complete · ${invoice.invoiceNo}`}>
            Stock and payments are recorded. Print the invoice or start the next sale.
          </Alert>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {session.permissions.includes("sale.create") ? (
            <Button asChild size="lg">
              <Link href="/pos">
                <CheckCircle2 aria-hidden />
                New sale
              </Link>
            </Button>
          ) : null}
          <PrintButton />
          <Button asChild size="lg" variant="ghost">
            <Link href="/pos/history">
              <History aria-hidden />
              Sales history
            </Link>
          </Button>
        </div>
      </div>
      <InvoiceView invoice={invoice} timezone={session.branch.timezone} />
    </>
  );
}
