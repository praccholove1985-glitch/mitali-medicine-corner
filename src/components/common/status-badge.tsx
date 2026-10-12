import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Info,
  PackageX,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { localizeText, type Locale } from "@/lib/i18n";

export type StatusTone = "neutral" | "primary" | "success" | "warning" | "danger" | "info";

const toneIcon: Record<StatusTone, React.ComponentType<{ "aria-hidden"?: boolean }>> = {
  neutral: Info,
  primary: Info,
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
};

/** Every status carries an icon and text; colour is reinforcement only. */
function StatusBadge({
  tone = "neutral",
  children,
  icon,
  locale = "en",
}: {
  tone?: StatusTone;
  children: React.ReactNode;
  icon?: React.ComponentType<{ "aria-hidden"?: boolean }>;
  locale?: Locale;
}) {
  const Icon = icon ?? toneIcon[tone];
  return (
    <Badge tone={tone}>
      <Icon aria-hidden />
      {typeof children === "string" ? localizeText(locale, children) : children}
    </Badge>
  );
}

export const EXPIRY_WARNING_DAYS = 90;
export const EXPIRY_CRITICAL_DAYS = 30;

/**
 * `daysToExpiry` must come from the server (it knows the pharmacy timezone).
 * 0 or less means expired: a batch expiring today is expired.
 */
function ExpiryBadge({ daysToExpiry, locale = "en" }: { daysToExpiry: number | null; locale?: Locale }) {
  if (daysToExpiry === null) {
    return <StatusBadge tone="neutral" locale={locale}>No expiry</StatusBadge>;
  }
  if (daysToExpiry <= 0) {
    return <StatusBadge tone="danger" icon={XCircle} locale={locale}>Expired</StatusBadge>;
  }
  if (daysToExpiry <= EXPIRY_CRITICAL_DAYS) {
    return (
      <StatusBadge tone="danger" icon={Clock} locale={locale}>
        {locale === "bn" ? daysToExpiry.toLocaleString("bn-BD") + " দিন বাকি" : `${daysToExpiry}d left`}
      </StatusBadge>
    );
  }
  if (daysToExpiry <= EXPIRY_WARNING_DAYS) {
    return (
      <StatusBadge tone="warning" icon={Clock} locale={locale}>
        {daysToExpiry}d left
      </StatusBadge>
    );
  }
  return <StatusBadge tone="success" locale={locale}>In date</StatusBadge>;
}

/** Thresholds come from the medicine's own reorder level, never a constant. */
function StockBadge({
  quantity,
  reorderLevel,
}: {
  quantity: number;
  reorderLevel: number;
}) {
  if (quantity <= 0) {
    return <StatusBadge tone="danger" icon={PackageX}>Out of stock</StatusBadge>;
  }
  if (quantity <= reorderLevel) {
    return <StatusBadge tone="warning" icon={AlertTriangle}>Low stock</StatusBadge>;
  }
  return <StatusBadge tone="success">In stock</StatusBadge>;
}

export { StatusBadge, ExpiryBadge, StockBadge };
