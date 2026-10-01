import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Construction } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { StatusBadge } from "@/components/common/status-badge";
import { canSee, placeholderModules } from "@/config/navigation";
import { getSessionContext } from "@/server/session";
import { ShieldOff } from "lucide-react";

type Props = { params: Promise<{ module: string }> };

// Only the modules in the navigation config exist; everything else is a 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return placeholderModules.map((item) => ({ module: item.href.slice(1) }));
}

function findModule(slug: string) {
  return placeholderModules.find((item) => item.href === `/${slug}`);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { module: slug } = await params;
  const item = findModule(slug);
  return { title: item?.label ?? "Not found" };
}

/**
 * Honest placeholder for modules whose backend does not exist yet. It states
 * what is planned and when; it never renders sample records.
 */
export default async function ModulePlaceholderPage({ params }: Props) {
  const { module: slug } = await params;
  const item = findModule(slug);
  if (!item) notFound();

  // The database is the real gate; this stops a user landing on a page whose
  // data they could not load anyway.
  const session = await getSessionContext();
  if (session.status === "ready" && !canSee(item, session.permissions)) {
    return (
      <>
        <PageHeader title={item.label} />
        <Card>
          <EmptyState
            size="page"
            icon={ShieldOff}
            title="You don't have access to this section"
            description="Ask the shop owner if you need it."
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={item.phase !== null ? `Planned · Phase ${item.phase}` : undefined}
        title={item.label}
        description={item.summary}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <EmptyState
            size="page"
            icon={Construction}
            title={`${item.label} isn't built yet`}
            description={
              item.phase !== null
                ? `This module arrives in Phase ${item.phase}. Until its database and permissions exist, nothing is shown here rather than made-up records.`
                : "This module is not available yet."
            }
          />
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>What it will do</CardTitle>
              <CardDescription>From the product specification</CardDescription>
            </div>
            <StatusBadge tone="primary">Planned</StatusBadge>
          </CardHeader>
          <CardContent>
            <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-foreground marker:text-muted-foreground">
              {item.planned.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
