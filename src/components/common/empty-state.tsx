import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type EmptyStateProps = {
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  /** Visual weight: `compact` inside cards/tables, `page` for a whole view. */
  size?: "compact" | "page";
  className?: string;
};

/** Says what is missing, why, and what to do next. */
function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  size = "compact",
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        size === "page" ? "px-6 py-16" : "px-4 py-10",
        className,
      )}
    >
      {Icon ? (
        <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary-text">
          <Icon className="size-6" aria-hidden />
        </div>
      ) : null}
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {description ? (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export { EmptyState };
