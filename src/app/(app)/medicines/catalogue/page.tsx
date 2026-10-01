import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { Forbidden } from "@/components/common/forbidden";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { CatalogueDialog } from "@/components/medicines/catalogue-dialog";
import { getCatalogue } from "@/server/db/medicines";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Companies & categories" };

export default async function CataloguePage() {
  const session = await requireSession();
  if (!session.permissions.includes("medicine.edit")) return <Forbidden section="companies and categories" />;

  const { companies, categories, subcategories } = await getCatalogue();

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
        <Link href="/medicines">
          <ArrowLeft aria-hidden />
          All medicines
        </Link>
      </Button>
      <PageHeader eyebrow="Medicines" title="Companies & categories" description="The lists medicines are grouped by. Retire an entry instead of deleting it so history stays intact." />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="h-fit">
          <CardHeader>
            <div>
              <CardTitle>Companies</CardTitle>
              <CardDescription>{companies.length} in the catalogue</CardDescription>
            </div>
            <CatalogueDialog kind="company" />
          </CardHeader>
          {companies.length === 0 ? (
            <EmptyState title="No companies yet" description="Add the manufacturers whose medicines you stock." />
          ) : (
            <ul className="divide-y border-t">
              {companies.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 px-5 py-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium">{c.name}</span>
                    {!c.isActive ? <StatusBadge tone="neutral">Retired</StatusBadge> : null}
                  </span>
                  <CatalogueDialog kind="company" item={c} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <div>
              <CardTitle>Categories</CardTitle>
              <CardDescription>{categories.length} with their subcategories</CardDescription>
            </div>
            <CatalogueDialog kind="category" />
          </CardHeader>
          {categories.length === 0 ? (
            <EmptyState title="No categories yet" description="Add categories such as Analgesics or Antibiotics." />
          ) : (
            <ul className="divide-y border-t">
              {categories.map((c) => {
                const subs = subcategories.filter((s) => s.categoryId === c.id);
                return (
                  <li key={c.id} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-semibold">{c.name}</span>
                        {!c.isActive ? <StatusBadge tone="neutral">Retired</StatusBadge> : null}
                      </span>
                      <span className="flex items-center gap-1">
                        <CatalogueDialog kind="subcategory" categoryId={c.id} triggerLabel="Subcategory" />
                        <CatalogueDialog kind="category" item={c} />
                      </span>
                    </div>
                    {subs.length > 0 ? (
                      <ul className="mt-2 flex flex-col gap-1 border-l pl-4">
                        {subs.map((s) => (
                          <li key={s.id} className="flex items-center justify-between gap-2">
                            <span className="flex min-w-0 items-center gap-2 text-sm">
                              <span className="truncate">{s.name}</span>
                              {!s.isActive ? <StatusBadge tone="neutral">Retired</StatusBadge> : null}
                            </span>
                            <CatalogueDialog kind="subcategory" categoryId={c.id} item={s} />
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
