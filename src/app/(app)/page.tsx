import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  Banknote,
  Boxes,
  Building2,
  CalendarClock,
  ClipboardList,
  PackageCheck,
  PackageSearch,
  Pill,
  Plus,
  ShieldAlert,
  ShoppingCart,
  Truck,
  Users,
  Wallet,
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
import { StatusBadge, ExpiryBadge } from "@/components/common/status-badge";
import { MoneyText } from "@/components/common/money-text";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { canSee } from "@/config/navigation";
import { formatDate } from "@/lib/dates";
import {
  getInventorySummary,
  listExpiry,
  type ExpiryItem,
  type InventorySummary,
} from "@/server/db/inventory";
import { getDueSummary, type DueSummary } from "@/server/db/customers";
import { getSupplierDueSummary, type SupplierDueSummary } from "@/server/db/suppliers";
import { getSessionContext } from "@/server/session";

export const metadata: Metadata = { title: "Dashboard" };

type MetricTone = "blue" | "green" | "amber" | "red" | "slate";

function MetricCard({
  label,
  value,
  caption,
  icon: Icon,
  tone = "blue",
  unavailable = false,
}: {
  label: string;
  value: React.ReactNode;
  caption: string;
  icon: typeof Banknote;
  tone?: MetricTone;
  unavailable?: boolean;
}) {
  const toneClasses: Record<MetricTone, string> = {
    blue: "bg-primary-soft text-primary-text",
    green: "bg-success-soft text-success-text",
    amber: "bg-warning-soft text-warning-text",
    red: "bg-danger-soft text-danger-text",
    slate: "bg-muted text-muted-foreground",
  };

  return (
    <Card className="flex min-h-[145px] flex-col gap-3 border-border/90 p-4 shadow-sm transition-shadow hover:shadow-md sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <span className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${toneClasses[tone]}`}>
          <Icon className="size-[18px]" aria-hidden />
        </span>
      </div>
      <div className="min-w-0">
        <p className="tabular text-[1.65rem] font-semibold leading-none tracking-tight text-foreground">
          {value}
        </p>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          {unavailable ? <span className="mr-1.5 inline-flex align-middle"><StatusBadge tone="neutral">Not connected</StatusBadge></span> : null}
          {caption}
        </p>
      </div>
    </Card>
  );
}

function QuickAction({
  href,
  label,
  description,
  icon: Icon,
}: {
  href: string;
  label: string;
  description: string;
  icon: typeof ShoppingCart;
}) {
  return (
    <Link
      href={href}
      className="group flex min-h-[84px] items-center gap-3 rounded-xl border border-border/90 bg-card p-3.5 transition-colors hover:border-primary/40 hover:bg-primary-soft/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-text transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
        <Icon className="size-[18px]" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">{label}</span>
        <span className="mt-1 block text-xs leading-4 text-muted-foreground">{description}</span>
      </span>
      <ArrowRight className="size-4 shrink-0 text-muted-foreground/70 transition-transform group-hover:translate-x-0.5 group-hover:text-primary-text" aria-hidden />
    </Link>
  );
}

export default async function DashboardPage() {
  const session = await getSessionContext();
  const ready = session.status === "ready";
  const permissions = ready ? session.permissions : [];

  let inventory: InventorySummary | null = null;
  let inventoryFailed = false;
  let due: DueSummary | null = null;
  let dueFailed = false;
  let supplierDue: SupplierDueSummary | null = null;
  let supplierDueFailed = false;
  let expiring: { items: ExpiryItem[]; total: number } | null = null;
  let expiringFailed = false;

  if (ready) {
    const tasks = await Promise.allSettled([
      permissions.includes("stock.view") ? getInventorySummary(session.branch.id) : Promise.resolve(null),
      permissions.includes("customer.view") ? getDueSummary(session.branch.id) : Promise.resolve(null),
      permissions.includes("supplier.view") ? getSupplierDueSummary(session.branch.id) : Promise.resolve(null),
      permissions.includes("stock.view") ? listExpiry(session.branch.id, "all", 1, 6) : Promise.resolve(null),
    ] as const);

    if (tasks[0].status === "fulfilled") inventory = tasks[0].value;
    else inventoryFailed = true;
    if (tasks[1].status === "fulfilled") due = tasks[1].value;
    else dueFailed = true;
    if (tasks[2].status === "fulfilled") supplierDue = tasks[2].value;
    else supplierDueFailed = true;
    if (tasks[3].status === "fulfilled") expiring = tasks[3].value;
    else expiringFailed = true;
  }

  const metrics = [
    ...(permissions.includes("sale.create") || permissions.includes("report.view") || permissions.includes("report.view_own")
      ? [{
          label: "Sales today",
          value: <span aria-hidden>—</span>,
          caption: "Sales summaries arrive with Reports (Phase 10).",
          icon: Banknote,
          tone: "blue" as const,
          unavailable: true,
        }]
      : []),
    ...(permissions.includes("stock.view")
      ? [
          {
            label: "Sellable units",
            value: inventory ? inventory.sellableUnits.toLocaleString("en-BD") : <span aria-hidden>—</span>,
            caption: inventory ? `${inventory.stockedMedicines.toLocaleString("en-BD")} medicines currently stocked` : inventoryFailed ? "Couldn't load stock summary. Refresh to retry." : "Live stock summary",
            icon: PackageCheck,
            tone: "green" as const,
            unavailable: !inventory,
          },
          {
            label: "Low stock",
            value: inventory ? inventory.lowStockCount.toLocaleString("en-BD") : <span aria-hidden>—</span>,
            caption: inventory ? `${inventory.outOfStockCount.toLocaleString("en-BD")} out of stock · reorder review` : inventoryFailed ? "Couldn't load stock summary. Refresh to retry." : "Live stock summary",
            icon: PackageSearch,
            tone: inventory && inventory.outOfStockCount > 0 ? "red" as const : "amber" as const,
            unavailable: !inventory,
          },
          {
            label: "Expiry watch",
            value: inventory ? (inventory.expiring30Batches + inventory.expiredBatches).toLocaleString("en-BD") : <span aria-hidden>—</span>,
            caption: inventory ? `${inventory.expiredBatches.toLocaleString("en-BD")} expired batches · ${inventory.expiring30Batches.toLocaleString("en-BD")} nearing expiry` : inventoryFailed ? "Couldn't load stock summary. Refresh to retry." : "Live batch summary",
            icon: CalendarClock,
            tone: inventory && (inventory.expiredBatches > 0 || inventory.expiring30Batches > 0) ? "red" as const : "slate" as const,
            unavailable: !inventory,
          },
        ]
      : []),
    ...(permissions.includes("customer.view")
      ? [{
          label: "Customer due",
          value: due ? <MoneyText amount={due.totalDue} fractionDigits={2} /> : <span aria-hidden>—</span>,
          caption: due ? `${due.customersWithDue.toLocaleString("en-BD")} customers have an outstanding balance` : dueFailed ? "Couldn't load customer balances. Refresh to retry." : "Live customer ledger",
          icon: Users,
          tone: "amber" as const,
          unavailable: !due,
        }]
      : []),
    ...(permissions.includes("supplier.view")
      ? [{
          label: "Supplier payable",
          value: supplierDue ? <MoneyText amount={supplierDue.totalPayable} fractionDigits={2} /> : <span aria-hidden>—</span>,
          caption: supplierDue ? `${supplierDue.suppliersWithDue.toLocaleString("en-BD")} suppliers with outstanding dues` : supplierDueFailed ? "Couldn't load supplier balances. Refresh to retry." : "Live supplier ledger",
          icon: Building2,
          tone: "blue" as const,
          unavailable: !supplierDue,
        }]
      : []),
    ...(permissions.includes("purchase.view_cost") && permissions.includes("stock.view")
      ? [{
          label: "Stock value at cost",
          value: inventory?.valueAtCost !== null && inventory?.valueAtCost !== undefined ? <MoneyText amount={inventory.valueAtCost} fractionDigits={2} /> : <span aria-hidden>—</span>,
          caption: inventory ? "Based on recorded batch costs" : inventoryFailed ? "Couldn't load stock value. Refresh to retry." : "Restricted to authorised roles",
          icon: Boxes,
          tone: "slate" as const,
          unavailable: !inventory || inventory.valueAtCost === null,
        }]
      : []),
  ];

  const actions = [
    { href: "/pos", label: "New sale", description: "Start a customer bill", icon: ShoppingCart, permission: "sale.create" },
    { href: "/medicines/new", label: "Add medicine", description: "Create a catalogue item", icon: Pill, permission: "medicine.edit" },
    { href: "/purchases/new", label: "Receive stock", description: "Enter a supplier invoice", icon: Truck, permission: "purchase.create" },
    { href: "/customers", label: "Customer ledger", description: "Review balances and payments", icon: Wallet, permission: "customer.view" },
    { href: "/inventory", label: "Stock overview", description: "Review batches and quantities", icon: Boxes, permission: "stock.view" },
    { href: "/suppliers", label: "Suppliers", description: "Check supplier balances", icon: Building2, permission: "supplier.view" },
  ].filter((action) => permissions.includes(action.permission));

  const attentionCount = inventory ? inventory.lowStockCount + inventory.outOfStockCount + inventory.expiring30Batches + inventory.expiredBatches : null;

  return (
    <>
      <PageHeader
        eyebrow="PHARMACY OPERATIONS"
        title="Dashboard"
        description="A practical overview of stock, expiry and outstanding balances."
        actions={
          <>
            {permissions.includes("stock.view") ? <Link href="/inventory" className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-3.5 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted"><Boxes className="size-4" aria-hidden /> Stock overview</Link> : null}
            {permissions.includes("sale.create") ? <Link href="/pos" className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"><Plus className="size-4" aria-hidden /> New sale</Link> : null}
          </>
        }
      />

      {!ready ? (
        <Alert tone="warning" title="Dashboard access is not ready">
          Your session does not currently have an active pharmacy branch. Sign out and sign in again, or ask an administrator to check staff access.
        </Alert>
      ) : null}

      {inventoryFailed || dueFailed || supplierDueFailed || expiringFailed ? (
        <Alert tone="warning" title="Some live figures could not be loaded" className="mb-5">
          The rest of the dashboard remains available. Refresh to retry the affected inventory or balance summaries.
        </Alert>
      ) : null}

      <section aria-labelledby="operations-metrics" className="mt-1">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="operations-metrics" className="text-sm font-semibold text-foreground">Today at a glance</h2>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><span className="size-1.5 rounded-full bg-success" aria-hidden /> Figures from your pharmacy records</span>
        </div>
        {metrics.length ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {metrics.map((metric) => <MetricCard key={metric.label} {...metric} />)}
          </div>
        ) : (
          <Card><CardContent className="py-6"><EmptyState icon={ShieldAlert} title="No dashboard figures available" description="Ask the shop administrator to check your role permissions." /></CardContent></Card>
        )}
      </section>

      <section className="mt-6 grid items-start gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(330px,0.9fr)]">
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-border/80 bg-muted/35 sm:px-5">
            <div>
              <div className="flex items-center gap-2"><CardTitle>Stock needing attention</CardTitle>{attentionCount !== null ? <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning-text">{attentionCount} flags</span> : null}</div>
              <CardDescription className="mt-1">Review low quantities and expiry risk before the next sale.</CardDescription>
            </div>
            {permissions.includes("stock.view") ? <Link href="/inventory" className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-primary-text hover:underline">Open inventory <ArrowRight className="size-3.5" aria-hidden /></Link> : null}
          </CardHeader>
          <CardContent className="p-4 sm:p-5">
            {!permissions.includes("stock.view") ? (
              <EmptyState icon={ShieldAlert} title="Stock access is restricted" description="Ask an administrator if you need to review stock and expiry." />
            ) : inventoryFailed ? (
              <ErrorState title="Inventory summary unavailable" message="Refresh the page to try again." />
            ) : inventory && inventory.lowStockCount + inventory.outOfStockCount + inventory.expiring30Batches + inventory.expiredBatches === 0 ? (
              <div className="flex items-start gap-3 rounded-xl border border-success/20 bg-success-soft/50 p-4">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-success-soft text-success-text"><PackageCheck className="size-5" aria-hidden /></span>
                <div><p className="text-sm font-semibold text-success-text">No urgent stock flags</p><p className="mt-1 text-xs leading-5 text-muted-foreground">There are no low/out-of-stock items or expiry flags in the current summary.</p></div>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <Link href="/inventory?filter=low" className="group rounded-xl border border-warning/25 bg-warning-soft/45 p-4 transition-colors hover:bg-warning-soft">
                  <div className="flex items-center justify-between gap-3"><span className="flex size-9 items-center justify-center rounded-lg bg-warning-soft text-warning-text"><PackageSearch className="size-5" aria-hidden /></span><ArrowRight className="size-4 text-warning-text transition-transform group-hover:translate-x-0.5" aria-hidden /></div>
                  <p className="mt-4 text-2xl font-semibold tracking-tight text-foreground">{inventory?.lowStockCount ?? "—"}</p>
                  <p className="mt-1 text-sm font-semibold">Low-stock medicines</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">At or below each medicine's reorder level.</p>
                </Link>
                <Link href="/inventory?filter=expired" className="group rounded-xl border border-danger/20 bg-danger-soft/45 p-4 transition-colors hover:bg-danger-soft">
                  <div className="flex items-center justify-between gap-3"><span className="flex size-9 items-center justify-center rounded-lg bg-danger-soft text-danger-text"><AlertTriangle className="size-5" aria-hidden /></span><ArrowRight className="size-4 text-danger-text transition-transform group-hover:translate-x-0.5" aria-hidden /></div>
                  <p className="mt-4 text-2xl font-semibold tracking-tight text-foreground">{inventory?.expiredBatches ?? "—"}</p>
                  <p className="mt-1 text-sm font-semibold">Expired batches</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">Keep expired stock out of the saleable inventory.</p>
                </Link>
              </div>
            )}
            {permissions.includes("stock.view") && inventory ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/80 px-3.5 py-3">
                <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground"><CalendarClock className="size-4 shrink-0 text-warning-text" aria-hidden /><span><strong className="font-semibold text-foreground">Expiry within 30 days:</strong> {inventory.expiring30Batches} batches</span></div>
                <Link href="/inventory/expiry" className="text-xs font-semibold text-primary-text hover:underline">Review expiry watch</Link>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div><CardTitle>Quick actions</CardTitle><CardDescription className="mt-1">Common pharmacy tasks, one click away.</CardDescription></div>
          </CardHeader>
          <CardContent className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            {actions.length ? actions.map((action) => <QuickAction key={action.href} {...action} />) : <p className="text-sm text-muted-foreground">No shortcuts are available for your role.</p>}
          </CardContent>
        </Card>
      </section>

      <section className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(330px,0.8fr)]">
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-border/80">
            <div><CardTitle>Expiry watch</CardTitle><CardDescription className="mt-1">Nearest expiry first, including expired batches with remaining stock.</CardDescription></div>
            {permissions.includes("stock.view") ? <Link href="/inventory/expiry" className="inline-flex items-center gap-1 text-xs font-semibold text-primary-text hover:underline">View all <ArrowRight className="size-3.5" aria-hidden /></Link> : null}
          </CardHeader>
          <CardContent className="p-0">
            {!permissions.includes("stock.view") ? (
              <div className="p-5"><EmptyState icon={ShieldAlert} title="Not available for your role" description="Ask the owner if you need expiry monitoring access." /></div>
            ) : expiringFailed ? (
              <div className="p-5"><ErrorState title="Couldn't load expiry data" message="Refresh the page to try again." /></div>
            ) : expiring && expiring.items.length > 0 ? (
              <div className="divide-y divide-border/80">
                {expiring.items.map((item) => <ExpiryRow key={item.batchId} item={item} />)}
              </div>
            ) : (
              <div className="p-5"><EmptyState icon={CalendarClock} title="No expiry flags to show" description="Batches with remaining stock will appear here when they are expired or approaching expiry." /></div>
            )}
            {expiring && expiring.total > expiring.items.length ? <div className="border-t border-border/80 px-5 py-3"><Link href="/inventory/expiry" className="text-xs font-semibold text-primary-text hover:underline">See all {expiring.total} matching batches</Link></div> : null}
          </CardContent>
        </Card>

        <div className="grid gap-4">
          <Card>
            <CardHeader><div><CardTitle>Balances to follow up</CardTitle><CardDescription className="mt-1">Keep customer credit and supplier dues visible.</CardDescription></div></CardHeader>
            <CardContent className="space-y-3">
              {permissions.includes("customer.view") ? <BalanceRow href="/customers" label="Customer due" detail={due ? `${due.customersWithDue} customers with balance` : dueFailed ? "Summary unavailable" : "Ledger summary"} icon={Users} amount={due ? <MoneyText amount={due.totalDue} fractionDigits={2} /> : "—"} /> : null}
              {permissions.includes("supplier.view") ? <BalanceRow href="/suppliers" label="Supplier payable" detail={supplierDue ? `${supplierDue.suppliersWithDue} suppliers with balance` : supplierDueFailed ? "Summary unavailable" : "Ledger summary"} icon={Building2} amount={supplierDue ? <MoneyText amount={supplierDue.totalPayable} fractionDigits={2} /> : "—"} /> : null}
              {!permissions.includes("customer.view") && !permissions.includes("supplier.view") ? <EmptyState icon={ShieldAlert} title="Balance details are restricted" description="Ask the owner if you need customer or supplier ledger access." /> : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><div><CardTitle>Sales & reporting</CardTitle><CardDescription className="mt-1">Daily totals and profit should always come from recorded transactions.</CardDescription></div><StatusBadge tone="neutral">Phase 10</StatusBadge></CardHeader>
            <CardContent>
              <div className="flex items-start gap-3 rounded-xl border border-dashed border-border bg-muted/35 p-4">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-text"><ClipboardList className="size-5" aria-hidden /></span>
                <div><p className="text-sm font-semibold">Reports are not connected yet</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Sales trends, profit summaries and recent invoice highlights will appear when the reporting module is implemented. No placeholder figures are shown as real totals.</p>{canSee({ anyOf: ["report.view", "report.view_own"] }, permissions) ? <Link href="/reports" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary-text hover:underline">Open reports <ArrowRight className="size-3.5" aria-hidden /></Link> : null}</div>
            </CardContent>
          </Card>
        </div>
      </section>

      <footer className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-border/80 pt-4 text-xs text-muted-foreground">
        <span>Mitali Medicine Corner · Boarding Market</span>
        <span className="inline-flex items-center gap-1.5"><ShieldAlert className="size-3.5" aria-hidden /> Stock and balances are permission-controlled.</span>
      </footer>
    </>
  );
}

function ExpiryRow({ item }: { item: ExpiryItem }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Pill className="size-[18px]" aria-hidden /></span>
      <div className="min-w-0 flex-1">
        <Link href={`/medicines/${item.medicineId}`} className="block truncate text-sm font-semibold text-foreground hover:text-primary-text hover:underline">{item.medicineName}{item.strength ? ` · ${item.strength}` : ""}</Link>
        <p className="mt-1 truncate text-xs text-muted-foreground">Batch {item.batchNumber} · {item.quantity.toLocaleString("en-BD")} units · Expires {formatDate(item.expiryDate)}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5"><ExpiryBadge daysToExpiry={item.daysToExpiry} /><span className="text-[11px] text-muted-foreground">{item.daysToExpiry <= 0 ? "Remove from sale" : `${item.daysToExpiry} days`}</span></div>
    </div>
  );
}

function BalanceRow({
  href,
  label,
  detail,
  icon: Icon,
  amount,
}: {
  href: string;
  label: string;
  detail: string;
  icon: typeof Users;
  amount: React.ReactNode;
}) {
  return (
    <Link href={href} className="group flex items-center gap-3 rounded-xl border border-border/80 p-3 transition-colors hover:border-primary/40 hover:bg-muted/40">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Icon className="size-4" aria-hidden /></span>
      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{label}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{detail}</span></span>
      <span className="text-right text-sm font-semibold tabular text-foreground">{amount}<ArrowDownRight className="ml-1 inline size-3.5 text-muted-foreground group-hover:text-primary-text" aria-hidden /></span>
    </Link>
  );
}
