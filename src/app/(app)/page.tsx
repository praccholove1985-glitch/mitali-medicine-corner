import type { Metadata } from "next";
import Link from "next/link";
import {
  Banknote,
  CalendarClock,
  Building2,
  LineChart,
  PackageSearch,
  Pill,
  ReceiptText,
  ShieldAlert,
  TrendingUp,
  Truck,
  Users,
  Wallet,
  Boxes,
} from "lucide-react";
import { Alert } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
import { StatCard } from "@/components/common/stat-card";
import { EmptyState } from "@/components/common/empty-state";
import { canSee } from "@/config/navigation";
import { StatusBadge } from "@/components/common/status-badge";
import { getSessionContext } from "@/server/session";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * Every figure is `null` until the backing feature exists. The dashboard must
 * never show a plausible-looking number that has no source, so the cards say
 * which phase will fill them in. Phase 10 replaces these with real queries.
 */
/**
 * `anyOf` mirrors the database permission that will protect the real figure.
 * Cost and profit cards are not even drawn for roles that may not see them.
 */
const kpis = [
  { label: "Today's sales", icon: Banknote, tone: "primary", note: "Available after Phase 5", anyOf: ["sale.create", "report.view", "report.view_own"] },
  { label: "Today's profit", icon: TrendingUp, tone: "success", note: "Available after Phase 5", anyOf: ["finance.view_profit"] },
  { label: "Today's purchases", icon: Truck, tone: "primary", note: "Available after Phase 7", anyOf: ["purchase.view"] },
  { label: "Stock value", icon: Boxes, tone: "neutral", note: "Available after Phase 4", anyOf: ["purchase.view_cost"] },
  { label: "Customer due", icon: Users, tone: "warning", note: "Available after Phase 6", anyOf: ["customer.view"] },
  { label: "Supplier due", icon: Building2, tone: "warning", note: "Available after Phase 7", anyOf: ["supplier.view"] },
  { label: "Low stock", icon: PackageSearch, tone: "warning", note: "Available after Phase 4", anyOf: ["stock.view"] },
  { label: "Expiring soon", icon: CalendarClock, tone: "danger", note: "Available after Phase 4", anyOf: ["stock.view"] },
] as const;

const quickActions = [
  { href: "/pos", label: "New sale", icon: ReceiptText, phase: 5, anyOf: ["sale.create"] },
  { href: "/medicines/new", label: "Add medicine", icon: Pill, phase: null, anyOf: ["medicine.edit"] },
  { href: "/purchases", label: "Receive stock", icon: Truck, phase: 7, anyOf: ["purchase.create"] },
  { href: "/customers", label: "Record payment", icon: Wallet, phase: 6, anyOf: ["customer.payment"] },
] as const;

export default async function DashboardPage() {
  const session = await getSessionContext();
  const permissions = session.status === "ready" ? session.permissions : [];
  const visibleKpis = kpis.filter((kpi) => canSee(kpi, permissions));
  const visibleActions = quickActions.filter((action) => canSee(action, permissions));

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Sales, stock and money at a glance."
      />

      <Alert tone="info" title="Figures arrive with each module" className="mb-6">
        Sign-in and permissions are live. Sales, stock and money figures are
        not recorded yet, so each card shows the phase that will fill it.
      </Alert>

      <section aria-labelledby="kpi-heading">
        <h2 id="kpi-heading" className="sr-only">
          Key figures
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {visibleKpis.map((kpi) => (
            <StatCard
              key={kpi.label}
              label={kpi.label}
              icon={kpi.icon}
              tone={kpi.tone}
              value={null}
              pendingNote={kpi.note}
            />
          ))}
        </div>
      </section>

      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Sales and profit</CardTitle>
              <CardDescription>Daily trend for the selected range</CardDescription>
            </div>
            <StatusBadge tone="neutral">Not connected</StatusBadge>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border border-dashed">
              <EmptyState
                icon={LineChart}
                title="No sales to chart yet"
                description="Once sales are recorded (Phase 5) the daily trend appears here, drawn from the database."
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Quick actions</CardTitle>
              <CardDescription>Shortcuts for the counter</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {visibleActions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No shortcuts are available for your role.
              </p>
            ) : null}
            <ul className="grid grid-cols-2 gap-2">
              {visibleActions.map((action) => (
                <li key={action.href}>
                  <Link
                    href={action.href}
                    className="flex min-h-24 flex-col items-start justify-between gap-3 rounded-lg border bg-card p-3 transition-colors hover:border-primary hover:bg-primary-soft"
                  >
                    <action.icon className="size-5 text-primary-text" aria-hidden />
                    <span className="flex flex-col">
                      <span className="text-sm font-medium text-foreground">
                        {action.label}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {action.phase === null ? "Ready" : `Phase ${action.phase}`}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Expiring soon</CardTitle>
              <CardDescription>Batches closest to their expiry date</CardDescription>
            </div>
            <StatusBadge tone="neutral">Not connected</StatusBadge>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border border-dashed">
              <EmptyState
                icon={ShieldAlert}
                title="No batch data yet"
                description="Expiry tracking starts with the inventory module (Phase 4). Expired stock is blocked from sale."
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Recent sales</CardTitle>
              <CardDescription>Latest invoices at the counter</CardDescription>
            </div>
            <StatusBadge tone="neutral">Not connected</StatusBadge>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border border-dashed">
              <EmptyState
                icon={ReceiptText}
                title="No sales recorded"
                description="Invoices will list here after the first sale is completed in the POS (Phase 5)."
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
