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
import { getLocale } from "@/lib/locale";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: "Dashboard" };

type MetricTone = "blue" | "green" | "amber" | "red" | "slate";

function MetricCard({
  label,
  value,
  caption,
  icon: Icon,
  tone = "blue",
  unavailable = false,
  locale,
}: {
  label: string;
  value: React.ReactNode;
  caption: string;
  icon: typeof Banknote;
  tone?: MetricTone;
  unavailable?: boolean;
  locale: "en" | "bn";
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
          {unavailable ? <span className="mr-1.5 inline-flex align-middle"><StatusBadge tone="neutral">{t(locale, "dashboard.notConnected")}</StatusBadge></span> : null}
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
  const [session, locale] = await Promise.all([getSessionContext(), getLocale()]);
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
          label: t(locale, "dashboard.salesToday"),
          value: <span aria-hidden>—</span>,
          caption: t(locale, "dashboard.salesNotReady"),
          icon: Banknote,
          tone: "blue" as const,
          unavailable: true,
        }]
      : []),
    ...(permissions.includes("stock.view")
      ? [
          {
            label: t(locale, "dashboard.sellableUnits"),
            value: inventory ? inventory.sellableUnits.toLocaleString("en-BD") : <span aria-hidden>—</span>,
            caption: inventory ? inventory.stockedMedicines.toLocaleString(locale === "bn" ? "bn-BD" : "en-BD") + " " + t(locale, "dashboard.stockedMedicines") : inventoryFailed ? t(locale, "dashboard.failedStock") : t(locale, "dashboard.stockSummaryLive"),
            icon: PackageCheck,
            tone: "green" as const,
            unavailable: !inventory,
          },
          {
            label: t(locale, "dashboard.lowStock"),
            value: inventory ? inventory.lowStockCount.toLocaleString("en-BD") : <span aria-hidden>—</span>,
            caption: inventory ? inventory.outOfStockCount.toLocaleString(locale === "bn" ? "bn-BD" : "en-BD") + " " + t(locale, "dashboard.outOfStock") + " · " + t(locale, "dashboard.reorderReview") : inventoryFailed ? t(locale, "dashboard.failedStock") : t(locale, "dashboard.stockSummaryLive"),
            icon: PackageSearch,
            tone: inventory && inventory.outOfStockCount > 0 ? "red" as const : "amber" as const,
            unavailable: !inventory,
          },
          {
            label: t(locale, "dashboard.expiryWatch"),
            value: inventory ? (inventory.expiring30Batches + inventory.expiredBatches).toLocaleString(locale === "bn" ? "bn-BD" : "en-BD") : <span aria-hidden>—</span>,
            caption: inventory ? inventory.expiredBatches.toLocaleString(locale === "bn" ? "bn-BD" : "en-BD") + " " + t(locale, "dashboard.expiredBatches") + " · " + inventory.expiring30Batches.toLocaleString(locale === "bn" ? "bn-BD" : "en-BD") + " " + t(locale, "dashboard.nearingExpiry") : inventoryFailed ? t(locale, "dashboard.failedStock") : (locale === "bn" ? "লাইভ ব্যাচ সারসংক্ষেপ" : "Live batch summary"),
            icon: CalendarClock,
            tone: inventory && (inventory.expiredBatches > 0 || inventory.expiring30Batches > 0) ? "red" as const : "slate" as const,
            unavailable: !inventory,
          },
        ]
      : []),
    ...(permissions.includes("customer.view")
      ? [{
          label: t(locale, "dashboard.customerDue"),
          value: due ? <MoneyText amount={due.totalDue} fractionDigits={2} /> : <span aria-hidden>—</span>,
          caption: due ? due.customersWithDue.toLocaleString(locale === "bn" ? "bn-BD" : "en-BD") + " " + t(locale, "dashboard.customersOutstanding") : dueFailed ? t(locale, "dashboard.failedDue") : (locale === "bn" ? "লাইভ গ্রাহক খাতা" : "Live customer ledger"),
          icon: Users,
          tone: "amber" as const,
          unavailable: !due,
        }]
      : []),
    ...(permissions.includes("supplier.view")
      ? [{
          label: t(locale, "dashboard.supplierPayable"),
          value: supplierDue ? <MoneyText amount={supplierDue.totalPayable} fractionDigits={2} /> : <span aria-hidden>—</span>,
          caption: supplierDue ? supplierDue.suppliersWithDue.toLocaleString(locale === "bn" ? "bn-BD" : "en-BD") + " " + t(locale, "dashboard.suppliersOutstanding") : supplierDueFailed ? t(locale, "dashboard.failedSupplier") : (locale === "bn" ? "লাইভ সরবরাহকারী খাতা" : "Live supplier ledger"),
          icon: Building2,
          tone: "blue" as const,
          unavailable: !supplierDue,
        }]
      : []),
    ...(permissions.includes("purchase.view_cost") && permissions.includes("stock.view")
      ? [{
          label: t(locale, "dashboard.stockValue"),
          value: inventory?.valueAtCost !== null && inventory?.valueAtCost !== undefined ? <MoneyText amount={inventory.valueAtCost} fractionDigits={2} /> : <span aria-hidden>—</span>,
          caption: inventory ? t(locale, "dashboard.batchCosts") : inventoryFailed ? t(locale, "dashboard.failedStock") : (locale === "bn" ? "অনুমোদিত ভূমিকার জন্য সীমাবদ্ধ" : "Restricted to authorised roles"),
          icon: Boxes,
          tone: "slate" as const,
          unavailable: !inventory || inventory.valueAtCost === null,
        }]
      : []),
  ];

  const actions = [
    { href: "/pos", label: t(locale, "dashboard.newSale"), description: t(locale, "dashboard.startBill"), icon: ShoppingCart, permission: "sale.create" },
    { href: "/medicines/new", label: t(locale, "dashboard.addMedicine"), description: t(locale, "dashboard.addMedicineDesc"), icon: Pill, permission: "medicine.edit" },
    { href: "/purchases/new", label: t(locale, "dashboard.receiveStock"), description: t(locale, "dashboard.receiveStockDesc"), icon: Truck, permission: "purchase.create" },
    { href: "/customers", label: t(locale, "dashboard.customerLedger"), description: t(locale, "dashboard.customerLedgerDesc"), icon: Wallet, permission: "customer.view" },
    { href: "/inventory", label: t(locale, "dashboard.stockOverview"), description: t(locale, "dashboard.stockOverviewDesc"), icon: Boxes, permission: "stock.view" },
    { href: "/suppliers", label: t(locale, "nav.Suppliers"), description: t(locale, "dashboard.suppliersDesc"), icon: Building2, permission: "supplier.view" },
  ].filter((action) => permissions.includes(action.permission));

  const attentionCount = inventory ? inventory.lowStockCount + inventory.outOfStockCount + inventory.expiring30Batches + inventory.expiredBatches : null;

  return (
    <>
      <PageHeader
        eyebrow={t(locale, "dashboard.eyebrow")}
        title={t(locale, "dashboard.title")}
        description={t(locale, "dashboard.description")}
        actions={
          <>
            {permissions.includes("stock.view") ? <Link href="/inventory" className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-3.5 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted"><Boxes className="size-4" aria-hidden /> {t(locale, "dashboard.stockOverview")}</Link> : null}
            {permissions.includes("sale.create") ? <Link href="/pos" className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"><Plus className="size-4" aria-hidden /> {t(locale, "dashboard.newSale")}</Link> : null}
          </>
        }
      />

      {!ready ? (
        <Alert tone="warning" title={t(locale, "dashboard.accessTitle")}>
          {t(locale, "dashboard.accessText")}
        </Alert>
      ) : null}

      {inventoryFailed || dueFailed || supplierDueFailed || expiringFailed ? (
        <Alert tone="warning" title={t(locale, "dashboard.loadTitle")} className="mb-5">
          {t(locale, "dashboard.loadText")}
        </Alert>
      ) : null}

      <section aria-labelledby="operations-metrics" className="mt-1">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="operations-metrics" className="text-sm font-semibold text-foreground">{t(locale, "dashboard.atAGlance")}</h2>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><span className="size-1.5 rounded-full bg-success" aria-hidden /> {t(locale, "dashboard.liveRecords")}</span>
        </div>
        {metrics.length ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {metrics.map((metric) => <MetricCard key={metric.label} {...metric} locale={locale} />)}
          </div>
        ) : (
          <Card><CardContent className="py-6"><EmptyState icon={ShieldAlert} title={t(locale, "dashboard.balanceRestricted")} description={t(locale, "dashboard.balanceRestrictedDesc")} /></CardContent></Card>
        )}
      </section>

      <section className="mt-6 grid items-start gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(330px,0.9fr)]">
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-border/80 bg-muted/35 sm:px-5">
            <div>
              <div className="flex items-center gap-2"><CardTitle>{t(locale, "dashboard.stockAttention")}</CardTitle>{attentionCount !== null ? <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning-text">{attentionCount.toLocaleString(locale === "bn" ? "bn-BD" : "en-BD")} {t(locale, "dashboard.flags")}</span> : null}</div>
              <CardDescription className="mt-1">{t(locale, "dashboard.stockAttentionDesc")}</CardDescription>
            </div>
            {permissions.includes("stock.view") ? <Link href="/inventory" className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-primary-text hover:underline">{t(locale, "dashboard.openInventory")} <ArrowRight className="size-3.5" aria-hidden /></Link> : null}
          </CardHeader>
          <CardContent className="p-4 sm:p-5">
            {!permissions.includes("stock.view") ? (
              <EmptyState icon={ShieldAlert} title={t(locale, "dashboard.stockRestricted")} description={t(locale, "dashboard.stockRestrictedDesc")} />
            ) : inventoryFailed ? (
              <ErrorState title={t(locale, "dashboard.stockUnavailable")} message={t(locale, "dashboard.refreshRetry")} />
            ) : inventory && inventory.lowStockCount + inventory.outOfStockCount + inventory.expiring30Batches + inventory.expiredBatches === 0 ? (
              <div className="flex items-start gap-3 rounded-xl border border-success/20 bg-success-soft/50 p-4">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-success-soft text-success-text"><PackageCheck className="size-5" aria-hidden /></span>
                <div><p className="text-sm font-semibold text-success-text">{t(locale, "dashboard.noUrgentFlags")}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{t(locale, "dashboard.noUrgentFlagsDesc")}</p></div>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <Link href="/inventory?filter=low" className="group rounded-xl border border-warning/25 bg-warning-soft/45 p-4 transition-colors hover:bg-warning-soft">
                  <div className="flex items-center justify-between gap-3"><span className="flex size-9 items-center justify-center rounded-lg bg-warning-soft text-warning-text"><PackageSearch className="size-5" aria-hidden /></span><ArrowRight className="size-4 text-warning-text transition-transform group-hover:translate-x-0.5" aria-hidden /></div>
                  <p className="mt-4 text-2xl font-semibold tracking-tight text-foreground">{inventory ? inventory.lowStockCount.toLocaleString(locale === "bn" ? "bn-BD" : "en-BD") : "—"}</p>
                  <p className="mt-1 text-sm font-semibold">{t(locale, "dashboard.lowStockMedicines")}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{t(locale, "dashboard.atReorder")}</p>
                </Link>
                <Link href="/inventory?filter=expired" className="group rounded-xl border border-danger/20 bg-danger-soft/45 p-4 transition-colors hover:bg-danger-soft">
                  <div className="flex items-center justify-between gap-3"><span className="flex size-9 items-center justify-center rounded-lg bg-danger-soft text-danger-text"><AlertTriangle className="size-5" aria-hidden /></span><ArrowRight className="size-4 text-danger-text transition-transform group-hover:translate-x-0.5" aria-hidden /></div>
                  <p className="mt-4 text-2xl font-semibold tracking-tight text-foreground">{inventory ? inventory.expiredBatches.toLocaleString(locale === "bn" ? "bn-BD" : "en-BD") : "—"}</p>
                  <p className="mt-1 text-sm font-semibold">{t(locale, "dashboard.expiredBatchTitle")}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{t(locale, "dashboard.expiredBatchDesc")}</p>
                </Link>
              </div>
            )}
            {permissions.includes("stock.view") && inventory ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/80 px-3.5 py-3">
                <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground"><CalendarClock className="size-4 shrink-0 text-warning-text" aria-hidden /><span><strong className="font-semibold text-foreground">{t(locale, "dashboard.expiryWithin")}:</strong> {inventory.expiring30Batches.toLocaleString(locale === "bn" ? "bn-BD" : "en-BD")} {locale === "bn" ? "টি ব্যাচ" : "batches"}</span></div>
                <Link href="/inventory/expiry" className="text-xs font-semibold text-primary-text hover:underline">{t(locale, "dashboard.reviewExpiry")}</Link>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div><CardTitle>{t(locale, "dashboard.quickActions")}</CardTitle><CardDescription className="mt-1">{t(locale, "dashboard.quickActionsDesc")}</CardDescription></div>
          </CardHeader>
          <CardContent className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            {actions.length ? actions.map((action) => <QuickAction key={action.href} {...action} />) : <p className="text-sm text-muted-foreground">{locale === "bn" ? "আপনার ভূমিকার জন্য কোনো শর্টকাট নেই।" : "No shortcuts are available for your role."}</p>}
          </CardContent>
        </Card>
      </section>

      <section className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(330px,0.8fr)]">
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-border/80">
            <div><CardTitle>{t(locale, "dashboard.expiryTitle")}</CardTitle><CardDescription className="mt-1">{t(locale, "dashboard.expiryDesc")}</CardDescription></div>
            {permissions.includes("stock.view") ? <Link href="/inventory/expiry" className="inline-flex items-center gap-1 text-xs font-semibold text-primary-text hover:underline">{t(locale, "dashboard.viewAll")} <ArrowRight className="size-3.5" aria-hidden /></Link> : null}
          </CardHeader>
          <CardContent className="p-0">
            {!permissions.includes("stock.view") ? (
              <div className="p-5"><EmptyState icon={ShieldAlert} title={t(locale, "dashboard.stockRestricted")} description={t(locale, "dashboard.stockRestrictedDesc")} /></div>
            ) : expiringFailed ? (
              <div className="p-5"><ErrorState title={t(locale, "dashboard.stockUnavailable")} message={t(locale, "dashboard.refreshRetry")} /></div>
            ) : expiring && expiring.items.length > 0 ? (
              <div className="divide-y divide-border/80">
                {expiring.items.map((item) => <ExpiryRow key={item.batchId} item={item} locale={locale} />)}
              </div>
            ) : (
              <div className="p-5"><EmptyState icon={CalendarClock} title={t(locale, "dashboard.noExpiryFlags")} description={t(locale, "dashboard.noExpiryFlagsDesc")} /></div>
            )}
            {expiring && expiring.total > expiring.items.length ? <div className="border-t border-border/80 px-5 py-3"><Link href="/inventory/expiry" className="text-xs font-semibold text-primary-text hover:underline">{t(locale, "dashboard.viewAll")} {expiring.total} {t(locale, "dashboard.matchingBatches")}</Link></div> : null}
          </CardContent>
        </Card>

        <div className="grid gap-4">
          <Card>
            <CardHeader><div><CardTitle>{t(locale, "dashboard.balances")}</CardTitle><CardDescription className="mt-1">{t(locale, "dashboard.balancesDesc")}</CardDescription></div></CardHeader>
            <CardContent className="space-y-3">
              {permissions.includes("customer.view") ? <BalanceRow href="/customers" label="Customer due" detail={due ? due.customersWithDue.toLocaleString(locale === "bn" ? "bn-BD" : "en-BD") + " " + t(locale, "dashboard.customersWithBalance") : dueFailed ? t(locale, "dashboard.summaryUnavailable") : t(locale, "dashboard.ledgerSummary")} icon={Users} amount={due ? <MoneyText amount={due.totalDue} fractionDigits={2} /> : "—"} /> : null}
              {permissions.includes("supplier.view") ? <BalanceRow href="/suppliers" label="Supplier payable" detail={supplierDue ? supplierDue.suppliersWithDue.toLocaleString(locale === "bn" ? "bn-BD" : "en-BD") + " " + t(locale, "dashboard.suppliersWithBalance") : supplierDueFailed ? t(locale, "dashboard.summaryUnavailable") : t(locale, "dashboard.ledgerSummary")} icon={Building2} amount={supplierDue ? <MoneyText amount={supplierDue.totalPayable} fractionDigits={2} /> : "—"} /> : null}
              {!permissions.includes("customer.view") && !permissions.includes("supplier.view") ? <EmptyState icon={ShieldAlert} title={t(locale, "dashboard.balanceRestricted")} description={t(locale, "dashboard.balanceRestrictedDesc")} /> : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><div><CardTitle>{t(locale, "dashboard.salesReporting")}</CardTitle><CardDescription className="mt-1">{t(locale, "dashboard.reportingDesc")}</CardDescription></div><StatusBadge tone="neutral">{t(locale, "dashboard.phase10")}</StatusBadge></CardHeader>
            <CardContent>
              <div className="flex items-start gap-3 rounded-xl border border-dashed border-border bg-muted/35 p-4">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-text"><ClipboardList className="size-5" aria-hidden /></span>
                <div><p className="text-sm font-semibold">{t(locale, "dashboard.reportingNotReady")}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{t(locale, "dashboard.reportingNotReadyDesc")}</p>{canSee({ anyOf: ["report.view", "report.view_own"] }, permissions) ? <Link href="/reports" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary-text hover:underline">{t(locale, "dashboard.openReports")} <ArrowRight className="size-3.5" aria-hidden /></Link> : null}</div>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <footer className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-border/80 pt-4 text-xs text-muted-foreground">
        <span>{t(locale, "dashboard.shopFooter")}</span>
        <span className="inline-flex items-center gap-1.5"><ShieldAlert className="size-3.5" aria-hidden /> {t(locale, "dashboard.permissionFooter")}</span>
      </footer>
    </>
  );
}

function ExpiryRow({ item, locale }: { item: ExpiryItem; locale: "en" | "bn" }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Pill className="size-[18px]" aria-hidden /></span>
      <div className="min-w-0 flex-1">
        <Link href={`/medicines/${item.medicineId}`} className="block truncate text-sm font-semibold text-foreground hover:text-primary-text hover:underline">{item.medicineName}{item.strength ? ` · ${item.strength}` : ""}</Link>
        <p className="mt-1 truncate text-xs text-muted-foreground">{locale === "bn" ? "ব্যাচ" : "Batch"} {item.batchNumber} · {item.quantity.toLocaleString(locale === "bn" ? "bn-BD" : "en-BD")} {locale === "bn" ? "ইউনিট" : "units"} · {t(locale, "dashboard.expires")} {formatDate(item.expiryDate)}</p>
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
