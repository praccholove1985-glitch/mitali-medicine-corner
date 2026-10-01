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
}: {
  tone?: StatusTone;
  children: React.ReactNode;
  icon?: React.ComponentType<{ "aria-hidden"?: boolean }>;
}) {
  const Icon = icon ?? toneIcon[tone];
  return (
    <Badge tone={tone}>
      <Icon aria-hidden />
      {children}
    </Badge>
  );
}

export const EXPIRY_WARNING_DAYS = 90;
export const EXPIRY_CRITICAL_DAYS = 30;

/**
 * `daysToExpiry` must come from the server (it knows the pharmacy timezone).
 * 0 or less means expired: a batch expiring today is expired.
 */
function ExpiryBadge({ daysToExpiry }: { daysToExpiry: number | null }) {
  if (daysToExpiry === null) {
    return <StatusBadge tone="neutral">No expiry</StatusBadge>;
  }
  if (daysToExpiry <= 0) {
    return <StatusBadge tone="danger" icon={XCircle}>Expired</StatusBadge>;
  }
  if (daysToExpiry <= EXPIRY_CRITICAL_DAYS) {
    return (
      <StatusBadge tone="danger" icon={Clock}>
        {daysToExpiry}d left
      </StatusBadge>
    );
  }
  if (daysToExpiry <= EXPIRY_WARNING_DAYS) {
    return (
      <StatusBadge tone="warning" icon={Clock}>
        {daysToExpiry}d left
      </StatusBadge>
    );
  }
  return <StatusBadge tone="success">In date</StatusBadge>;
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
