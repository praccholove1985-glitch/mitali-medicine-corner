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
import { ExpiryBadge, StatusBadge } from "@/components/common/status-badge";
import { MoneyText } from "@/components/common/money-text";
import { getInventorySummary, listExpiry, type ExpiryItem, type InventorySummary } from "@/server/db/inventory";
import { getDueSummary, type DueSummary } from "@/server/db/customers";
import { ErrorState } from "@/components/common/error-state";
import { formatDate } from "@/lib/dates";
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
  { label: "Today's sales", icon: Banknote, tone: "primary", note: "Available with reports (Phase 10)", anyOf: ["sale.create", "report.view", "report.view_own"] },
  { label: "Today's profit", icon: TrendingUp, tone: "success", note: "Available with reports (Phase 10)", anyOf: ["finance.view_profit"] },
  { label: "Today's purchases", icon: Truck, tone: "primary", note: "Available after Phase 7", anyOf: ["purchase.view"] },
  { label: "Stock value", icon: Boxes, tone: "neutral", note: "", anyOf: ["purchase.view_cost"] },
  { label: "Customer due", icon: Users, tone: "warning", note: "", anyOf: ["customer.view"] },
  { label: "Supplier due", icon: Building2, tone: "warning", note: "Available after Phase 7", anyOf: ["supplier.view"] },
  { label: "Low stock", icon: PackageSearch, tone: "warning", note: "", anyOf: ["stock.view"] },
  { label: "Expiring soon", icon: CalendarClock, tone: "danger", note: "", anyOf: ["stock.view"] },
] as const;

const quickActions = [
  { href: "/pos", label: "New sale", icon: ReceiptText, phase: null, anyOf: ["sale.create"] },
  { href: "/medicines/new", label: "Add medicine", icon: Pill, phase: null, anyOf: ["medicine.edit"] },
  { href: "/purchases", label: "Receive stock", icon: Truck, phase: 7, anyOf: ["purchase.create"] },
  { href: "/customers", label: "Record payment", icon: Wallet, phase: null, anyOf: ["customer.payment"] },
] as const;

export default async function DashboardPage() {
  const session = await getSessionContext();
  const permissions = session.status === "ready" ? session.permissions : [];
  const visibleKpis = kpis.filter((kpi) => canSee(kpi, permissions));

  // Stock figures are real now. If the lookup fails the cards say so rather than showing zeros.
  let inventory: InventorySummary | null = null;
  let inventoryFailed = false;
  if (session.status === "ready" && permissions.includes("stock.view")) {
    try {
      inventory = await getInventorySummary(session.branch.id);
    } catch {
      inventoryFailed = true;
    }
  }

  let due: DueSummary | null = null;
  let dueFailed = false;
  if (session.status === "ready" && permissions.includes("customer.view")) {
    try {
      due = await getDueSummary(session.branch.id);
    } catch {
      dueFailed = true;
    }
  }

  let expiring: { items: ExpiryItem[]; total: number } | null = null;
  let expiringFailed = false;
  if (session.status === "ready" && permissions.includes("stock.view")) {
    try {
      expiring = await listExpiry(session.branch.id, "all", 1, 5);
    } catch {
      expiringFailed = true;
    }
  }

  const live = (label: string): { value: React.ReactNode | null; caption?: string } => {
    if (label === "Customer due") {
      return due === null
        ? { value: null }
        : {
            value: <MoneyText amount={due.totalDue} fractionDigits={2} />,
            caption: `${due.customersWithDue} customer${due.customersWithDue === 1 ? "" : "s"} owe`,
          };
    }
    if (!inventory) return { value: null };
    switch (label) {
      case "Low stock":
        return { value: inventory.lowStockCount, caption: "at or below reorder level" };
      case "Expiring soon":
        return { value: inventory.expiring30Batches, caption: "batches within 30 days" };
      case "Stock value":
        return inventory.valueAtCost === null
          ? { value: null }
          : { value: <MoneyText amount={inventory.valueAtCost} fractionDigits={2} />, caption: "at cost, all batches on hand" };
      default:
        return { value: null };
    }
  };
  const visibleActions = quickActions.filter((action) => canSee(action, permissions));

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Sales, stock and money at a glance."
      />

      <Alert tone="info" title="Figures arrive with each module" className="mb-6">
        Stock and customer-due figures are live. Sales totals, profit and purchases
        are not summarised here yet, so those cards show the phase that will fill them.
      </Alert>

      <section aria-labelledby="kpi-heading">
        <h2 id="kpi-heading" className="sr-only">
          Key figures
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {visibleKpis.map((kpi) => {
            const { value, caption } = live(kpi.label);
            const stockCard = ["Low stock", "Expiring soon", "Stock value"].includes(kpi.label);
            const dueCard = kpi.label === "Customer due";
            return (
              <StatCard
                key={kpi.label}
                label={kpi.label}
                icon={kpi.icon}
                tone={kpi.tone}
                value={value}
                caption={caption}
                pendingNote={
                  stockCard
                    ? inventoryFailed ? "Couldn't load, try refreshing" : undefined
                    : dueCard
                      ? dueFailed ? "Couldn't load, try refreshing" : undefined
                      : kpi.note
                }
              />
            );
          })}
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
                title="No chart yet"
                description="The daily trend is drawn from the database with the reports (Phase 10)."
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
              <CardDescription>Closest to their expiry date, including anything already expired</CardDescription>
            </div>
            {expiring === null && !expiringFailed ? <StatusBadge tone="neutral">No access</StatusBadge> : null}
          </CardHeader>
          <CardContent>
            {expiringFailed ? (
              <div className="rounded-lg border border-dashed">
                <ErrorState title="Couldn't load expiry data" message="Try refreshing the page." />
              </div>
            ) : expiring === null ? (
              <div className="rounded-lg border border-dashed">
                <EmptyState icon={ShieldAlert} title="Not available for your role" description="Ask the shop owner if you need to see stock." />
              </div>
            ) : expiring.items.length === 0 ? (
              <div className="rounded-lg border border-dashed">
                <EmptyState
                  icon={ShieldAlert}
                  title="Nothing is expiring in the next 90 days"
                  description="Batches with stock that expire within 90 days, or already have, will be listed here."
                />
              </div>
            ) : (
              <>
                <ul className="divide-y rounded-lg border">
                  {expiring.items.map((item) => (
                    <li key={item.batchId} className="flex items-center justify-between gap-3 px-3 py-2">
                      <div className="min-w-0">
                        <Link href={`/medicines/${item.medicineId}`} className="block truncate text-sm font-medium hover:text-primary-text hover:underline">
                          {item.medicineName}
                        </Link>
                        <span className="text-xs text-muted-foreground">
                          Batch {item.batchNumber} · {item.quantity} unit{item.quantity === 1 ? "" : "s"} · {formatDate(item.expiryDate)}
                        </span>
                      </div>
                      <ExpiryBadge daysToExpiry={item.daysToExpiry} />
                    </li>
                  ))}
                </ul>
                <Link href="/inventory/expiry" className="mt-3 inline-block text-sm font-medium text-primary-text hover:underline">
                  {expiring.total > expiring.items.length ? `See all ${expiring.total} batches` : "Open expiry watch"}
                </Link>
              </>
            )}
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
                title="Not shown here yet"
                description="Open Sales history in the POS to see invoices. This panel is filled in with the reports (Phase 10)."
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
