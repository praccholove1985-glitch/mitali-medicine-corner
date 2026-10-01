import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/common/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type StatCardProps = {
  label: string;
  icon: LucideIcon;
  /**
   * Already formatted value. `null` means "no data source yet": the card shows
   * a dash and the pending note rather than a number.
   */
  value: React.ReactNode | null;
  /** Shown under the value when there is data. */
  caption?: string;
  /** Shown when `value` is null, e.g. "Available after Phase 5". */
  pendingNote?: string;
  loading?: boolean;
  /** Visual accent of the icon chip. */
  tone?: "primary" | "success" | "warning" | "danger" | "neutral";
  className?: string;
};

const chip: Record<NonNullable<StatCardProps["tone"]>, string> = {
  primary: "bg-primary-soft text-primary-text",
  success: "bg-success-soft text-success-text",
  warning: "bg-warning-soft text-warning-text",
  danger: "bg-danger-soft text-danger-text",
  neutral: "bg-muted text-muted-foreground",
};

function StatCard({
  label,
  icon: Icon,
  value,
  caption,
  pendingNote,
  loading = false,
  tone = "primary",
  className,
}: StatCardProps) {
  return (
    <Card className={cn("flex flex-col gap-3 p-4", className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <span
          className={cn(
            "flex size-8 items-center justify-center rounded-lg",
            chip[tone],
          )}
        >
          <Icon className="size-4" aria-hidden />
        </span>
      </div>
      {loading ? (
        <div role="status" aria-live="polite" className="flex flex-col gap-2">
          <span className="sr-only">Loading {label}…</span>
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-3 w-20" />
        </div>
      ) : value === null ? (
        <div className="flex flex-col gap-2">
          <p className="tabular text-2xl font-semibold text-muted-foreground">
            <span aria-hidden>—</span>
            <span className="sr-only">Not available yet</span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="neutral">Not connected</StatusBadge>
            {pendingNote ? (
              <span className="text-xs text-muted-foreground">{pendingNote}</span>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <p className="tabular text-2xl font-semibold tracking-tight text-foreground">
            {value}
          </p>
          {caption ? (
            <p className="text-xs text-muted-foreground">{caption}</p>
          ) : null}
        </div>
      )}
    </Card>
  );
}

export { StatCard };
