import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Banknote,
  Boxes,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileText,
  Package,
  PackageSearch,
  Pill,
  Plus,
  Receipt,
  ShoppingCart,
  Sun,
  Moon,
  Sunrise,
  TrendingUp,
  Truck,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { MoneyText } from "@/components/common/money-text";
import { StatusBadge, ExpiryBadge } from "@/components/common/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { canSee } from "@/config/navigation";
import { formatDate, formatDateTime, todayInTimezone } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";
import { getDashboardOverview, type DashboardDay } from "@/server/db/dashboard";
import { getInventorySummary, listExpiry, listStock, type ExpiryItem, type InventorySummary, type StockItem } from "@/server/db/inventory";
import { getDueSummary, type DueSummary } from "@/server/db/customers";
import { getSupplierDueSummary, type SupplierDueSummary } from "@/server/db/suppliers";
import { listSales, type SaleListItem } from "@/server/db/pos";
import { getSessionContext } from "@/server/session";

export const metadata: Metadata = { title: "Dashboard" };

type Tone = "green" | "mint" | "amber" | "blue" | "slate";

type Metric = {
  label: string;
  value: React.ReactNode;
  caption: string;
  icon: LucideIcon;
  tone: Tone;
  series?: Array<string | null>;
  live?: boolean;
};

function shiftDate(isoDate: string, amount: number): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function dateLabel(isoDate: string, locale: "en" | "bn", timeZone: string, withYear = false): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  return new Intl.DateTimeFormat(locale === "bn" ? "bn-BD" : "en-GB", {
    day: "2-digit",
    month: "short",
    ...(withYear ? { year: "numeric" as const } : {}),
    timeZone: "UTC",
  }).format(date);
}

function numberLabel(value: number, locale: "en" | "bn"): string {
  return value.toLocaleString(locale === "bn" ? "bn-BD" : "en-BD");
}

function buildLine(values: number[], width: number, height: number, pad: number, maxValue?: number): string {
  if (values.length < 2) return "";
  const max = Math.max(maxValue ?? 0, ...values, 1);
  const min = Math.min(0, ...values);
  const range = Math.max(1, max - min);
  return values.map((value, index) => {
    const x = pad + (index * (width - pad * 2)) / (values.length - 1);
    const y = height - pad - ((value - min) / range) * (height - pad * 2);
    return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
}

function buildArea(values: number[], width: number, height: number, pad: number, maxValue?: number): string {
  const line = buildLine(values, width, height, pad, maxValue);
  if (!line) return "";
  const endX = width - pad;
  return `${line} L ${endX} ${height - pad} L ${pad} ${height - pad} Z`;
}

function Sparkline({ values, tone }: { values: Array<string | null>; tone: Tone }) {
  const numbers = values.map((value) => value === null ? 0 : Number(value));
  const hasValues = values.some((value) => value !== null);
  const color: Record<Tone, string> = {
    green: "text-primary",
    mint: "text-success",
    amber: "text-warning-text",
    blue: "text-sky-700",
    slate: "text-slate-500",
  };
  if (!hasValues || numbers.length < 2) {
    return <span className="inline-flex h-8 items-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{hasValues ? "LIVE" : "—"}</span>;
  }
  const line = buildLine(numbers, 160, 34, 4);
  const area = buildArea(numbers, 160, 34, 4);
  return (
    <svg viewBox="0 0 160 34" className={`h-8 w-full ${color[tone]}`} role="img" aria-label="Recent daily trend">
      <path d={area} fill="currentColor" opacity=".10" />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MetricCard({ metric, locale }: { metric: Metric; locale: "en" | "bn" }) {
  const tones: Record<Tone, string> = {
    green: "bg-emerald-50 text-emerald-800 ring-emerald-100",
    mint: "bg-green-50 text-green-700 ring-green-100",
    amber: "bg-amber-50 text-amber-800 ring-amber-100",
    blue: "bg-sky-50 text-sky-800 ring-sky-100",
    slate: "bg-slate-50 text-slate-700 ring-slate-200",
  };
  const Icon = metric.icon;
  return (
    <Card className="group relative min-w-0 overflow-hidden border-[#d8e9df] bg-white shadow-[0_1px_2px_rgba(13,67,39,.035)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_22px_rgba(13,67,39,.08)]">
      <div className={`absolute inset-x-0 top-0 h-1 ${metric.tone === "amber" ? "bg-amber-400" : metric.tone === "blue" ? "bg-sky-500" : metric.tone === "slate" ? "bg-slate-300" : "bg-primary"}`} />
      <div className="flex items-start gap-3 px-4 pb-1 pt-5 sm:px-5">
        <span className={`flex size-10 shrink-0 items-center justify-center rounded-2xl ring-1 ${tones[metric.tone]}`}>
          <Icon className="size-[19px]" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="truncate text-[12px] font-semibold text-[#5a7465]">{metric.label}</p>
          <div className="mt-1.5 truncate text-[23px] font-bold leading-tight tracking-[-.7px] text-[#0b4b2b] sm:text-[25px]">{metric.value}</div>
          <p className="mt-1 min-h-8 text-[11px] leading-[1.5] text-[#6e8578]">{metric.caption}</p>
        </div>
      </div>
      <div className="px-4 pb-3 pt-0 sm:px-5"><Sparkline values={metric.series ?? []} tone={metric.tone} /></div>
    </Card>
  );
}

function PanelTitle({ icon: Icon, title, description, href, hrefLabel, tone = "green", locale }: {
  icon: LucideIcon;
  title: string;
  description: string;
  href?: string;
  hrefLabel?: string;
  tone?: Tone;
  locale: "en" | "bn";
}) {
  const iconClass: Record<Tone, string> = {
    green: "bg-emerald-50 text-primary",
    mint: "bg-green-50 text-green-700",
    amber: "bg-amber-50 text-amber-800",
    blue: "bg-sky-50 text-sky-800",
    slate: "bg-slate-50 text-slate-700",
  };
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[#e7f0ea] px-4 py-4 sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${iconClass[tone]}`}><Icon className="size-[19px]" aria-hidden /></span>
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-bold tracking-[-.2px] text-[#142c20]">{title}</h2>
          <p className="mt-0.5 text-[11px] text-[#708579]">{description}</p>
        </div>
      </div>
      {href ? <Link href={href} className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-primary hover:underline">{hrefLabel ?? (locale === "bn" ? "সব দেখুন" : "View all")} <ArrowRight className="size-3.5" aria-hidden /></Link> : null}
    </div>
  );
}

function QuickAction({ href, label, description, icon: Icon, tone = "green", primary = false }: {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
  tone?: Tone;
  primary?: boolean;
}) {
  const style: Record<Tone, string> = {
    green: "border-[#dbece1] bg-[#f2faf5] text-primary hover:bg-[#e7f6ec]",
    mint: "border-[#dbece1] bg-[#f0faf3] text-green-700 hover:bg-[#e7f6ec]",
    amber: "border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100",
    blue: "border-sky-200 bg-sky-50 text-sky-900 hover:bg-sky-100",
    slate: "border-slate-200 bg-slate-50 text-slate-800 hover:bg-slate-100",
  };
  return (
    <Link href={href} className={`group flex min-h-[74px] items-center gap-3 rounded-xl border p-3.5 transition-all duration-150 hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${primary ? "border-primary bg-primary text-white shadow-sm hover:bg-primary-hover" : style[tone]}`}>
      <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${primary ? "bg-white/15 text-white" : "bg-white/80"}`}><Icon className="size-[19px]" aria-hidden /></span>
      <span className="min-w-0 flex-1">
        <span className={`block text-[13px] font-bold ${primary ? "text-white" : "text-[#153526]"}`}>{label}</span>
        <span className={`mt-1 block text-[11px] leading-4 ${primary ? "text-white/75" : "text-[#6e8578]"}`}>{description}</span>
      </span>
      <ArrowRight className={`size-4 shrink-0 transition-transform group-hover:translate-x-0.5 ${primary ? "text-white" : "text-[#6d8a79]"}`} aria-hidden />
    </Link>
  );
}

type AttentionRow = {
  id: string;
  name: string;
  details: string;
  stock: string;
  status: string;
  tone: "danger" | "warning" | "info";
  href: string;
};

function makeAttentionRows(lowStock: StockItem[], outOfStock: StockItem[], expiry: ExpiryItem[], locale: "en" | "bn"): AttentionRow[] {
  const rows: AttentionRow[] = [];
  for (const item of outOfStock) {
    rows.push({
      id: `out-${item.medicineId}`,
      name: `${item.name}${item.strength ? ` ${item.strength}` : ""}`,
      details: [item.dosageForm, item.companyName].filter(Boolean).join(" · ") || (locale === "bn" ? "ওষুধের ক্যাটালগ" : "Medicine catalogue"),
      stock: `0 ${item.unit}`,
      status: locale === "bn" ? "স্টক শেষ" : "Out of stock",
      tone: "danger",
      href: "/inventory?filter=out",
    });
  }
  for (const item of lowStock) {
    rows.push({
      id: `low-${item.medicineId}`,
      name: `${item.name}${item.strength ? ` ${item.strength}` : ""}`,
      details: `${item.companyName ?? item.dosageForm ?? (locale === "bn" ? "মজুত" : "Stock")}` + ` · ${locale === "bn" ? "পুনঃঅর্ডার" : "Reorder"}: ${numberLabel(item.reorderLevel, locale)}`,
      stock: `${numberLabel(item.sellableQty, locale)} ${item.unit}`,
      status: locale === "bn" ? "কম স্টক" : "Low stock",
      tone: "warning",
      href: "/inventory?filter=low",
    });
  }
  const upcoming = expiry.filter((item) => item.daysToExpiry <= 30).sort((a, b) => a.daysToExpiry - b.daysToExpiry);
  for (const item of upcoming) {
    rows.push({
      id: `expiry-${item.batchId}`,
      name: `${item.medicineName}${item.strength ? ` ${item.strength}` : ""}`,
      details: `${locale === "bn" ? "ব্যাচ" : "Batch"} ${item.batchNumber} · ${formatDate(item.expiryDate)}`,
      stock: `${numberLabel(item.quantity, locale)} ${locale === "bn" ? "ইউনিট" : "units"}`,
      status: item.daysToExpiry <= 0 ? (locale === "bn" ? "মেয়াদ শেষ" : "Expired") : item.daysToExpiry <= 7 ? (locale === "bn" ? `${numberLabel(item.daysToExpiry, locale)} দিন বাকি` : `${item.daysToExpiry}d left`) : (locale === "bn" ? "মেয়াদ আসন্ন" : "Expiring"),
      tone: item.daysToExpiry <= 0 || item.daysToExpiry <= 7 ? "danger" : "info",
      href: "/inventory/expiry",
    });
  }
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = row.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 5);
}

export default async function DashboardPage() {
  const [session, locale] = await Promise.all([getSessionContext(), getLocale()]);
  const ready = session.status === "ready";
  const permissions = ready ? session.permissions : [];
  const timeZone = ready ? session.branch.timezone : "Asia/Dhaka";
  const today = todayInTimezone(timeZone);
  const from = shiftDate(today, -6);
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", hour12: false }).format(new Date()));
  const greeting = hour >= 5 && hour < 12
    ? (locale === "bn" ? "শুভ সকাল!" : "Good morning!")
    : hour >= 12 && hour < 17
      ? (locale === "bn" ? "শুভ দুপুর!" : "Good afternoon!")
      : hour >= 17 && hour < 22
        ? (locale === "bn" ? "শুভ সন্ধ্যা!" : "Good evening!")
        : (locale === "bn" ? "স্বাগতম!" : "Welcome back!");
  const todayFormatted = new Intl.DateTimeFormat(locale === "bn" ? "bn-BD" : "en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone,
  }).format(new Date());

  const canViewSales = permissions.includes("sale.create") || permissions.includes("sale.view_all") || permissions.includes("report.view") || permissions.includes("report.view_own");
  const canViewProfit = canViewSales && (permissions.includes("finance.view_profit") || permissions.includes("report.view") || permissions.includes("report.view_own"));
  const canViewPurchases = permissions.includes("purchase.view") || permissions.includes("report.view");
  const canViewPurchaseValue = permissions.includes("report.view") || (permissions.includes("purchase.view") && permissions.includes("purchase.view_cost"));
  const canViewStock = permissions.includes("stock.view");
  const canViewCost = permissions.includes("purchase.view_cost");

  let overview: DashboardDay[] = [];
  let overviewFailed = false;
  let inventory: InventorySummary | null = null;
  let inventoryFailed = false;
  let due: DueSummary | null = null;
  let dueFailed = false;
  let supplierDue: SupplierDueSummary | null = null;
  let supplierDueFailed = false;
  let lowStock: StockItem[] = [];
  let outOfStock: StockItem[] = [];
  let expiring: ExpiryItem[] = [];
  let stockListsFailed = false;
  let recentSales: SaleListItem[] = [];
  let recentSalesFailed = false;

  if (ready) {
    const results = await Promise.allSettled([
      canViewSales || canViewPurchases ? getDashboardOverview(session.branch.id, from, today) : Promise.resolve(null),
      canViewStock ? getInventorySummary(session.branch.id) : Promise.resolve(null),
      permissions.includes("customer.view") ? getDueSummary(session.branch.id) : Promise.resolve(null),
      permissions.includes("supplier.view") ? getSupplierDueSummary(session.branch.id) : Promise.resolve(null),
      canViewStock ? listStock(session.branch.id, "", "low", 1, 5) : Promise.resolve(null),
      canViewStock ? listStock(session.branch.id, "", "out", 1, 5) : Promise.resolve(null),
      canViewStock ? listExpiry(session.branch.id, "all", 1, 25) : Promise.resolve(null),
      (permissions.includes("sale.view_all") || permissions.includes("sale.create"))
        ? listSales(session.branch.id, { query: "", from: null, to: null, beforeSeq: null }, 5)
        : Promise.resolve(null),
    ] as const);

    if (results[0].status === "fulfilled") overview = results[0].value ?? [];
    else overviewFailed = true;
    if (results[1].status === "fulfilled") inventory = results[1].value;
    else inventoryFailed = true;
    if (results[2].status === "fulfilled") due = results[2].value;
    else dueFailed = true;
    if (results[3].status === "fulfilled") supplierDue = results[3].value;
    else supplierDueFailed = true;
    if (results[4].status === "fulfilled") lowStock = results[4].value?.items ?? [];
    else stockListsFailed = true;
    if (results[5].status === "fulfilled") outOfStock = results[5].value?.items ?? [];
    else stockListsFailed = true;
    if (results[6].status === "fulfilled") expiring = results[6].value?.items ?? [];
    else stockListsFailed = true;
    if (results[7].status === "fulfilled") recentSales = results[7].value?.items ?? [];
    else recentSalesFailed = true;
  }

  const todayOverview = overview.find((day) => day.day === today);
  const salesSeries = overview.map((day) => day.salesTotal);
  const profitSeries = overview.map((day) => day.grossProfit);
  const purchaseSeries = overview.map((day) => day.purchaseTotal);
  const stockAttention = makeAttentionRows(lowStock, outOfStock, expiring, locale);
  const salesNumbers = overview.map((day) => Number(day.salesTotal ?? "0"));
  const profitNumbers = overview.map((day) => Number(day.grossProfit ?? "0"));
  const graphMax = Math.max(...salesNumbers, ...profitNumbers, 1);
  const hasSalesAccess = canViewSales && !overviewFailed && overview.some((day) => day.salesTotal !== null);
  const hasSalesInRange = overview.some((day) => Number(day.salesCount ?? 0) > 0);
  const chartSalesPath = buildLine(salesNumbers, 700, 175, 16, graphMax * 1.1);
  const chartSalesArea = buildArea(salesNumbers, 700, 175, 16, graphMax * 1.1);
  const chartProfitPath = profitNumbers.some((value) => value > 0) ? buildLine(profitNumbers, 700, 175, 16, graphMax * 1.1) : "";
  const lowCount = inventory ? inventory.lowStockCount : null;
  const outCount = inventory ? inventory.outOfStockCount : null;

  const metrics: Metric[] = [];
  if (canViewSales) metrics.push({
    label: locale === "bn" ? "আজকের বিক্রয়" : "Today's Sales",
    value: <MoneyText amount={todayOverview?.salesTotal} fractionDigits={2} className="text-[23px] sm:text-[25px]" />,
    caption: todayOverview?.salesCount !== null && todayOverview?.salesCount !== undefined
      ? locale === "bn" ? `${numberLabel(todayOverview.salesCount, locale)}টি ইনভয়েস আজ` : `${numberLabel(todayOverview.salesCount, locale)} invoices recorded today`
      : overviewFailed ? (locale === "bn" ? "বিক্রয়ের তথ্য লোড করা যায়নি" : "Sales data could not be loaded") : (locale === "bn" ? "আপনার অনুমতির জন্য সারসংক্ষেপ নেই" : "Summary unavailable for your role"),
    icon: Banknote,
    tone: "green",
    series: salesSeries,
    live: true,
  });
  if (canViewProfit) metrics.push({
    label: locale === "bn" ? "মোট লাভ" : "Gross Profit",
    value: <MoneyText amount={todayOverview?.grossProfit} fractionDigits={2} className="text-[23px] sm:text-[25px]" />,
    caption: locale === "bn" ? "বিক্রিত ব্যাচের রেকর্ড করা ক্রয়মূল্য অনুযায়ী" : "Calculated from recorded batch costs",
    icon: TrendingUp,
    tone: "mint",
    series: profitSeries,
    live: true,
  });
  if (canViewPurchases) metrics.push({
    label: locale === "bn" ? "আজকের ক্রয়" : "Purchases Today",
    value: todayOverview?.purchaseTotal !== null && todayOverview?.purchaseTotal !== undefined
      ? <MoneyText amount={todayOverview.purchaseTotal} fractionDigits={2} className="text-[23px] sm:text-[25px]" />
      : todayOverview?.purchaseCount !== null && todayOverview?.purchaseCount !== undefined
        ? <span className="text-[22px]">{numberLabel(todayOverview.purchaseCount, locale)} <span className="text-[12px] font-semibold">{locale === "bn" ? "ইনভয়েস" : "invoices"}</span></span>
        : <span>—</span>,
    caption: todayOverview?.purchaseCount !== null && todayOverview?.purchaseCount !== undefined
      ? locale === "bn" ? `${numberLabel(todayOverview.purchaseCount, locale)}টি সরবরাহকারী ইনভয়েস` : `${numberLabel(todayOverview.purchaseCount, locale)} supplier invoices`
      : canViewPurchaseValue ? (locale === "bn" ? "ক্রয়ের তথ্য লোড করা যায়নি" : "Purchase data could not be loaded") : (locale === "bn" ? "মূল্য দেখার অনুমতি সীমাবদ্ধ" : "Purchase amount restricted by role"),
    icon: Truck,
    tone: "amber",
    series: purchaseSeries,
    live: true,
  });
  if (canViewStock && inventory) {
    metrics.push({
      label: canViewCost && inventory.valueAtCost !== null
        ? (locale === "bn" ? "মোট স্টকের মূল্য" : "Total Stock Value")
        : (locale === "bn" ? "বিক্রয়যোগ্য ইউনিট" : "Sellable Units"),
      value: canViewCost && inventory.valueAtCost !== null
        ? <MoneyText amount={inventory.valueAtCost} fractionDigits={2} className="text-[23px] sm:text-[25px]" />
        : <span>{numberLabel(inventory.sellableUnits, locale)}</span>,
      caption: canViewCost && inventory.valueAtCost !== null
        ? (locale === "bn" ? "ব্যাচের রেকর্ড করা ক্রয়মূল্য অনুযায়ী" : "Based on recorded batch costs")
        : (locale === "bn" ? `${numberLabel(inventory.stockedMedicines, locale)}টি ওষুধ বর্তমানে মজুত` : `${numberLabel(inventory.stockedMedicines, locale)} medicines currently stocked`),
      icon: Boxes,
      tone: "blue",
      live: true,
    });
  } else if (canViewStock && inventoryFailed) {
    metrics.push({
      label: t(locale, "dashboard.sellableUnits"),
      value: <span>—</span>,
      caption: t(locale, "dashboard.failedStock"),
      icon: Boxes,
      tone: "blue",
    });
  }
  if (permissions.includes("customer.view") && due && metrics.length < 4) metrics.push({
    label: t(locale, "dashboard.customerDue"),
    value: <MoneyText amount={due.totalDue} fractionDigits={2} className="text-[23px] sm:text-[25px]" />,
    caption: locale === "bn" ? `${numberLabel(due.customersWithDue, locale)} জন গ্রাহকের বকেয়া` : `${numberLabel(due.customersWithDue, locale)} customers with outstanding balances`,
    icon: Users,
    tone: "amber",
  });
  if (permissions.includes("supplier.view") && supplierDue && metrics.length < 4) metrics.push({
    label: t(locale, "dashboard.supplierPayable"),
    value: <MoneyText amount={supplierDue.totalPayable} fractionDigits={2} className="text-[23px] sm:text-[25px]" />,
    caption: locale === "bn" ? `${numberLabel(supplierDue.suppliersWithDue, locale)} জন সরবরাহকারীর পাওনা` : `${numberLabel(supplierDue.suppliersWithDue, locale)} suppliers with outstanding balances`,
    icon: Building2,
    tone: "slate",
  });
  if (canViewStock && inventory && metrics.length < 4) metrics.push({
    label: locale === "bn" ? "কম স্টক" : "Low Stock",
    value: <span>{numberLabel(lowCount ?? 0, locale)}</span>,
    caption: locale === "bn" ? `${numberLabel(outCount ?? 0, locale)}টির স্টক শেষ` : `${numberLabel(outCount ?? 0, locale)} items out of stock`,
    icon: PackageSearch,
    tone: "amber",
  });

  const actions = [
    { href: "/pos", label: locale === "bn" ? "নতুন বিক্রয়" : "New Sale", description: locale === "bn" ? "POS কাউন্টার খুলুন" : "Open POS counter", icon: ShoppingCart, tone: "green" as const, primary: true, permission: "sale.create" },
    { href: "/medicines/new", label: locale === "bn" ? "ওষুধ যোগ করুন" : "Add Medicine", description: locale === "bn" ? "নতুন পণ্য তৈরি করুন" : "Create new product", icon: Pill, tone: "mint" as const, primary: false, permission: "medicine.edit" },
    { href: "/purchases/new", label: locale === "bn" ? "স্টক গ্রহণ" : "Receive Stock", description: locale === "bn" ? "ক্রয়ের ইনভয়েস রেকর্ড করুন" : "Record purchase invoice", icon: Truck, tone: "amber" as const, primary: false, permission: "purchase.create" },
    { href: "/inventory", label: locale === "bn" ? "ইনভেন্টরি" : "Inventory", description: locale === "bn" ? "পরিমাণ ও মেয়াদ দেখুন" : "Quantities and expiry", icon: Boxes, tone: "blue" as const, primary: false, permission: "stock.view" },
    { href: "/customers", label: locale === "bn" ? "গ্রাহক" : "Customers", description: locale === "bn" ? "গ্রাহক ও বকেয়া দেখুন" : "Customers and balances", icon: Users, tone: "mint" as const, primary: false, permission: "customer.view" },
    { href: "/suppliers", label: locale === "bn" ? "সরবরাহকারী" : "Suppliers", description: locale === "bn" ? "সরবরাহকারী খাতা খুলুন" : "Open supplier ledger", icon: Building2, tone: "slate" as const, primary: false, permission: "supplier.view" },
  ].filter((action) => permissions.includes(action.permission)).slice(0, 4);

  return (
    <div className="mx-auto max-w-[1500px] pb-6">
      {!ready ? (
        <Alert tone="warning" title={t(locale, "dashboard.accessTitle")}>
          {t(locale, "dashboard.accessText")}
        </Alert>
      ) : null}

      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#e7f6e9] text-primary ring-1 ring-[#d3eadb]">
            {hour >= 6 && hour < 18 ? <Sun className="size-6" aria-hidden /> : hour >= 18 || hour < 5 ? <Moon className="size-6" aria-hidden /> : <Sunrise className="size-6" aria-hidden />}
          </span>
          <div className="min-w-0">
            <h1 className="text-[25px] font-bold tracking-[-.75px] text-[#103e28] sm:text-[29px]">{greeting}</h1>
            <p className="mt-1 text-[13px] text-[#6c8577]">{locale === "bn" ? "আজ আপনার ফার্মেসির কার্যক্রমের সারসংক্ষেপ।" : "Here's what's happening at your pharmacy today."}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 self-start rounded-xl border border-[#d7e9de] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(13,67,39,.035)] sm:self-auto">
          <CalendarDays className="size-5 text-primary" aria-hidden />
          <div><p className="text-[12px] font-bold text-[#203c2d]">{locale === "bn" ? "আজ" : "Today"}</p><p className="mt-0.5 text-xs text-[#718779]">{todayFormatted}</p></div>
          <span className="ml-4 size-2 rounded-full bg-emerald-500" aria-label={locale === "bn" ? "লাইভ তারিখ" : "Current date"} />
        </div>
      </div>

      {inventoryFailed || dueFailed || supplierDueFailed || stockListsFailed || overviewFailed ? (
        <Alert tone="warning" title={locale === "bn" ? "কিছু তথ্য লোড করা যায়নি" : "Some dashboard data could not be loaded"} className="mb-4">
          {locale === "bn" ? "সংশ্লিষ্ট মডিউলের লাইভ তথ্য আবার আনতে পেজ রিফ্রেশ করুন।" : "The rest of the dashboard is available. Refresh to retry affected live summaries."}
        </Alert>
      ) : null}

      {metrics.length > 0 ? (
        <section aria-label={locale === "bn" ? "আজকের সারসংক্ষেপ" : "Today's summary"} className="mb-4 grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
          {metrics.slice(0, 4).map((metric) => <MetricCard key={metric.label} metric={metric} locale={locale} />)}
        </section>
      ) : null}

      <div className="mb-4 grid items-stretch gap-4 2xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,.9fr)]">
        <Card className="min-w-0 overflow-hidden border-[#d6e8dd] bg-white shadow-[0_1px_2px_rgba(13,67,39,.035)]">
          <PanelTitle
            icon={Activity}
            title={locale === "bn" ? "বিক্রয়ের সারসংক্ষেপ" : "Sales Overview"}
            description={locale === "bn" ? "দৈনিক বিক্রয় ও লাভের প্রবণতা (BDT)" : "Daily sales and profit trend (BDT)"}
            tone="green"
            locale={locale}
            href={canSee({ anyOf: ["report.view", "report.view_own"] }, permissions) ? "/reports" : undefined}
            hrefLabel={locale === "bn" ? "রিপোর্ট খুলুন" : "Open reports"}
          />
          <div className="px-4 pb-4 pt-3 sm:px-5">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-4 text-[11px] text-[#5f7869]">
                <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-primary" />{locale === "bn" ? "বিক্রয়" : "Sales"}</span>
                {canViewProfit ? <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-emerald-300" />{locale === "bn" ? "মোট লাভ" : "Gross Profit"}</span> : null}
              </div>
              <span className="rounded-lg border border-[#dceae2] bg-[#f9fcfa] px-3 py-1.5 text-[11px] font-medium text-[#557364]">{locale === "bn" ? "গত ৭ দিন" : "Last 7 days"}</span>
            </div>
            {!hasSalesAccess ? (
              <div className="flex min-h-[180px] items-center justify-center rounded-xl border border-dashed border-[#dbe9e0] bg-[#fbfdfb] px-6 text-center">
                <EmptyState icon={Activity} title={locale === "bn" ? "বিক্রয় চার্টের অনুমতি নেই" : "Sales chart access unavailable"} description={locale === "bn" ? "এই চার্ট দেখতে রিপোর্ট বা বিক্রয়ের অনুমতি প্রয়োজন।" : "A sales or reports permission is needed to view this chart."} />
              </div>
            ) : hasSalesInRange ? (
              <>
                <svg viewBox="0 0 700 175" className="h-[175px] w-full overflow-visible" preserveAspectRatio="none" role="img" aria-label={locale === "bn" ? "গত সাত দিনের বিক্রয় ও লাভ" : "Sales and profit for the last seven days"}>
                  {[28, 64, 100, 136].map((y) => <line key={y} x1="16" y1={y} x2="684" y2={y} stroke="#e5eee8" strokeDasharray="3 4" strokeWidth="1" />)}
                  {overview.map((day, index) => {
                    const x = 16 + (index * 668) / Math.max(overview.length - 1, 1);
                    return <line key={day.day} x1={x} y1="16" x2={x} y2="159" stroke="#edf3ef" strokeWidth="1" />;
                  })}
                  <path d={chartSalesArea} fill="#0b6638" opacity=".13" />
                  <path d={chartSalesPath} fill="none" stroke="#0b6638" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                  {chartProfitPath ? <path d={chartProfitPath} fill="none" stroke="#83bf92" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /> : null}
                  {salesNumbers.map((value, index) => {
                    const x = 16 + (index * 668) / Math.max(salesNumbers.length - 1, 1);
                    const max = Math.max(graphMax * 1.1, 1);
                    const y = 159 - (value / max) * 143;
                    return <circle key={index} cx={x} cy={y} r="3.3" fill="#0b6638" stroke="#fff" strokeWidth="1.2" />;
                  })}
                </svg>
                <div className="mt-1 grid grid-cols-7 gap-1">
                  {overview.map((day) => <span key={day.day} className="truncate text-center text-[10px] text-[#829589]">{dateLabel(day.day, locale, timeZone)}</span>)}
                </div>
              </>
            ) : (
              <div className="flex min-h-[180px] flex-col items-center justify-center rounded-xl border border-dashed border-[#dbe9e0] bg-[#fbfdfb] px-6 text-center">
                <span className="mb-2 flex size-10 items-center justify-center rounded-full bg-[#eaf6ed] text-primary"><Activity className="size-5" aria-hidden /></span>
                <p className="text-sm font-bold text-[#244b35]">{locale === "bn" ? "এখনো বিক্রয় নেই" : "No sales in this period"}</p>
                <p className="mt-1 max-w-xs text-xs leading-5 text-[#7a8d81]">{locale === "bn" ? "বিক্রয় রেকর্ড হলে এখানে দৈনিক প্রবণতা দেখা যাবে।" : "Daily sales and profit will plot here as recorded sales come in."}</p>
              </div>
            )}
          </div>
        </Card>

        <Card className="min-w-0 overflow-hidden border-[#d6e8dd] bg-white shadow-[0_1px_2px_rgba(13,67,39,.035)]">
          <PanelTitle icon={Activity} title={locale === "bn" ? "দ্রুত কাজ" : "Quick Actions"} description={locale === "bn" ? "দৈনন্দিন কাজ দ্রুত সম্পন্ন করুন" : "Common tasks for faster pharmacy operations"} tone="amber" locale={locale} />
          <CardContent className="grid gap-2.5 p-4 sm:grid-cols-2 2xl:grid-cols-2">
            {actions.map((action) => <QuickAction key={action.href} {...action} />)}
            {actions.length === 0 ? <p className="text-sm text-muted-foreground">{locale === "bn" ? "আপনার ভূমিকার জন্য কোনো শর্টকাট নেই।" : "No shortcuts are available for your role."}</p> : null}
          </CardContent>
        </Card>
      </div>

      <div className="grid items-start gap-4 2xl:grid-cols-2">
        <Card className="min-w-0 overflow-hidden border-[#d6e8dd] bg-white shadow-[0_1px_2px_rgba(13,67,39,.035)]">
          <PanelTitle
            icon={Receipt}
            title={locale === "bn" ? "সাম্প্রতিক বিক্রয়" : "Recent Sales"}
            description={locale === "bn" ? "কাউন্টারের সর্বশেষ ইনভয়েস" : "Latest invoices from the counter"}
            tone="mint"
            locale={locale}
            href={(permissions.includes("sale.create") || permissions.includes("sale.view_all")) ? "/pos/history" : undefined}
          />
          {!(permissions.includes("sale.create") || permissions.includes("sale.view_all")) ? (
            <div className="p-5"><EmptyState icon={Receipt} title={locale === "bn" ? "বিক্রয় ইতিহাসের অনুমতি নেই" : "Sales history is restricted"} description={locale === "bn" ? "সাম্প্রতিক ইনভয়েস দেখতে বিক্রয় অনুমতি প্রয়োজন।" : "Sales permission is required to view recent invoices."} /></div>
          ) : recentSalesFailed ? (
            <div className="p-5"><ErrorState title={locale === "bn" ? "সাম্প্রতিক বিক্রয় লোড হয়নি" : "Recent sales could not be loaded"} message={locale === "bn" ? "আবার চেষ্টা করতে পেজ রিফ্রেশ করুন।" : "Refresh the page to try again."} /></div>
          ) : recentSales.length === 0 ? (
            <div className="p-5"><EmptyState icon={Receipt} title={locale === "bn" ? "এখনো কোনো বিক্রয় নেই" : "No sales yet"} description={locale === "bn" ? "সম্পন্ন বিক্রয়ের ইনভয়েস এখানে দেখা যাবে।" : "Completed sales and their invoices appear here."} /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-xs">
                <thead className="bg-[#eef8f1] text-[10px] uppercase tracking-wide text-[#577565]">
                  <tr>
                    <th className="px-4 py-3 font-bold">{locale === "bn" ? "ইনভয়েস" : "Invoice"}</th>
                    <th className="px-4 py-3 font-bold">{locale === "bn" ? "গ্রাহক" : "Customer"}</th>
                    <th className="px-4 py-3 font-bold">{locale === "bn" ? "পেমেন্ট" : "Payment"}</th>
                    <th className="px-4 py-3 text-right font-bold">{locale === "bn" ? "মোট (BDT)" : "Total (BDT)"}</th>
                  </tr>
                </thead>
                <tbody>
                  {recentSales.map((sale) => (
                    <tr key={sale.saleId} className="border-t border-[#eaf1ec] transition-colors hover:bg-[#f8fcf9]">
                      <td className="px-4 py-3">
                        <Link href={`/pos/invoices/${sale.saleId}`} className="font-mono text-[11px] font-bold text-primary hover:underline">{sale.invoiceNo}</Link>
                        <p className="mt-1 text-[10px] text-[#829589]">{formatDateTime(sale.soldAt, timeZone)}</p>
                      </td>
                      <td className="px-4 py-3 font-medium text-[#395344]">{sale.customerName ?? (locale === "bn" ? "ওয়াক-ইন গ্রাহক" : "Walk-in customer")}</td>
                      <td className="px-4 py-3">
                        {Number(sale.dueTotal) > 0
                          ? <span className="inline-flex rounded-md bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-800">{locale === "bn" ? "আংশিক" : "Partial"}</span>
                          : <span className="inline-flex rounded-md bg-emerald-100 px-2 py-1 text-[10px] font-bold text-emerald-800">{locale === "bn" ? "পরিশোধিত" : "Paid"}</span>}
                      </td>
                      <td className="px-4 py-3 text-right font-bold tabular text-[#183c29]"><MoneyText amount={sale.grandTotal} fractionDigits={2} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex items-center justify-between gap-3 border-t border-[#e7f0ea] bg-[#fcfefc] px-4 py-2.5 text-[10px] text-[#819387]">
            <span>{locale === "bn" ? "বিক্রয়ের ইতিহাস থেকে লাইভ তথ্য" : "Live records from sales history"}</span>
            {permissions.includes("sale.create") || permissions.includes("sale.view_all") ? <Link href="/pos/history" className="inline-flex items-center gap-1 font-bold text-primary hover:underline">{locale === "bn" ? "সব ইনভয়েস" : "All invoices"} <ArrowUpRight className="size-3" /></Link> : null}
          </div>
        </Card>

        <Card className="min-w-0 overflow-hidden border-[#d6e8dd] bg-white shadow-[0_1px_2px_rgba(13,67,39,.035)]">
          <PanelTitle
            icon={AlertTriangle}
            title={locale === "bn" ? "স্টকে নজর দিন" : "Stock Needs Attention"}
            description={locale === "bn" ? "কম স্টক, মেয়াদ ও পুনঃঅর্ডার সতর্কতা" : "Low-stock items and expiry alerts"}
            tone="amber"
            locale={locale}
            href={canViewStock ? "/inventory" : undefined}
          />
          {!canViewStock ? (
            <div className="p-5"><EmptyState icon={Boxes} title={t(locale, "dashboard.stockRestricted")} description={t(locale, "dashboard.stockRestrictedDesc")} /></div>
          ) : stockListsFailed ? (
            <div className="p-5"><ErrorState title={t(locale, "dashboard.stockUnavailable")} message={t(locale, "dashboard.refreshRetry")} /></div>
          ) : stockAttention.length === 0 ? (
            <div className="p-5"><EmptyState icon={CheckCircle2} title={t(locale, "dashboard.noUrgentFlags")} description={t(locale, "dashboard.noUrgentFlagsDesc")} /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[460px] text-left text-xs">
                <thead className="bg-[#eef8f1] text-[10px] uppercase tracking-wide text-[#577565]">
                  <tr>
                    <th className="px-4 py-3 font-bold">{locale === "bn" ? "ওষুধ" : "Medicine"}</th>
                    <th className="px-4 py-3 font-bold">{locale === "bn" ? "স্টক / বিস্তারিত" : "Stock / details"}</th>
                    <th className="px-4 py-3 text-right font-bold">{locale === "bn" ? "অবস্থা" : "Status"}</th>
                  </tr>
                </thead>
                <tbody>
                  {stockAttention.map((row) => (
                    <tr key={row.id} className="border-t border-[#eaf1ec] transition-colors hover:bg-[#f8fcf9]">
                      <td className="px-4 py-2.5">
                        <Link href={row.href} className="flex min-w-0 items-center gap-2.5 hover:text-primary">
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#f0f8f3] text-primary"><Pill className="size-4" aria-hidden /></span>
                          <span className="min-w-0"><span className="block max-w-[220px] truncate text-[11px] font-bold text-[#253f30]">{row.name}</span><span className="mt-1 block max-w-[220px] truncate text-[10px] text-[#7e9185]">{row.details}</span></span>
                        </Link>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="block text-[11px] font-bold text-[#314f3e]">{row.stock}</span>
                        {row.id.startsWith("expiry-") ? <span className="mt-1 block text-[10px] text-[#839589]">{locale === "bn" ? "মেয়াদের অ্যালার্ট" : "Expiry alert"}</span> : null}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span className={`inline-flex whitespace-nowrap rounded-md px-2 py-1 text-[10px] font-bold ${row.tone === "danger" ? "bg-rose-100 text-rose-700" : row.tone === "warning" ? "bg-amber-100 text-amber-800" : "bg-sky-100 text-sky-800"}`}>{row.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex items-center justify-between gap-3 border-t border-[#e7f0ea] bg-[#fcfefc] px-4 py-2.5 text-[10px] text-[#819387]">
            <span>{inventory ? `${numberLabel(inventory.lowStockCount, locale)} ${locale === "bn" ? "কম স্টক" : "low-stock items"} · ${numberLabel(inventory.expiredBatches + inventory.expiring30Batches, locale)} ${locale === "bn" ? "মেয়াদ সতর্কতা" : "expiry flags"}` : (locale === "bn" ? "স্টকের লাইভ তথ্য" : "Live inventory data")}</span>
            {canViewStock ? <Link href="/inventory/expiry" className="inline-flex items-center gap-1 font-bold text-primary hover:underline">{locale === "bn" ? "মেয়াদ দেখুন" : "Expiry watch"} <ArrowUpRight className="size-3" /></Link> : null}
          </div>
        </Card>
      </div>

      {(due && permissions.includes("customer.view") || supplierDue && permissions.includes("supplier.view")) ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {due && permissions.includes("customer.view") ? (
            <Link href="/customers" className="flex items-center gap-3 rounded-xl border border-[#d8e9df] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(13,67,39,.035)] transition-colors hover:bg-[#f6fcf8]">
              <span className="flex size-10 items-center justify-center rounded-xl bg-amber-50 text-amber-800"><Users className="size-5" aria-hidden /></span>
              <div className="min-w-0 flex-1"><p className="text-xs font-semibold text-[#6d8577]">{t(locale, "dashboard.customerDue")}</p><p className="mt-1 text-lg font-bold text-[#164b2e]"><MoneyText amount={due.totalDue} fractionDigits={2} /></p><p className="text-[10px] text-[#839488]">{numberLabel(due.customersWithDue, locale)} {locale === "bn" ? "জন গ্রাহকের বকেয়া" : "customers with outstanding balance"}</p></div><ArrowRight className="size-4 text-[#7d9586]" />
            </Link>
          ) : null}
          {supplierDue && permissions.includes("supplier.view") ? (
            <Link href="/suppliers" className="flex items-center gap-3 rounded-xl border border-[#d8e9df] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(13,67,39,.035)] transition-colors hover:bg-[#f6fcf8]">
              <span className="flex size-10 items-center justify-center rounded-xl bg-sky-50 text-sky-800"><Building2 className="size-5" aria-hidden /></span>
              <div className="min-w-0 flex-1"><p className="text-xs font-semibold text-[#6d8577]">{t(locale, "dashboard.supplierPayable")}</p><p className="mt-1 text-lg font-bold text-[#164b2e]"><MoneyText amount={supplierDue.totalPayable} fractionDigits={2} /></p><p className="text-[10px] text-[#839488]">{numberLabel(supplierDue.suppliersWithDue, locale)} {locale === "bn" ? "জন সরবরাহকারীর পাওনা" : "suppliers with outstanding balance"}</p></div><ArrowRight className="size-4 text-[#7d9586]" />
            </Link>
          ) : null}
        </div>
      ) : null}

      <footer className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-[#dceae2] pt-3 text-[10px] text-[#8a9b90]">
        <span>Mitali Medicine Corner · {ready ? session.branch.name : "Boarding Market"}</span>
        <span className="inline-flex items-center gap-1.5"><Activity className="size-3.5" aria-hidden />{locale === "bn" ? "ইনভেন্টরি ও বকেয়ার তথ্য লাইভ ডাটাবেস থেকে আসে।" : "Inventory and balance figures come from live records."}</span>
      </footer>
    </div>
  );
}
