import { Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Announces loading to assistive tech once; skeleton blocks stay silent. */
function LoadingState({
  label = "Loading",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted-foreground",
        className,
      )}
    >
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label}…
    </div>
  );
}

/** Skeleton shaped like a table so the layout does not jump when data arrives. */
function TableSkeleton({
  rows = 6,
  columns = 5,
  label = "Loading table",
}: {
  rows?: number;
  columns?: number;
  label?: string;
}) {
  return (
    <div role="status" aria-live="polite" className="px-4 py-3">
      <span className="sr-only">{label}…</span>
      <div className="flex flex-col gap-3">
        {Array.from({ length: rows }, (_, row) => (
          <div key={row} className="flex gap-4">
            {Array.from({ length: columns }, (_, col) => (
              <Skeleton
                key={col}
                className={cn("h-5", col === 0 ? "w-1/3" : "flex-1")}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export { LoadingState, TableSkeleton };
