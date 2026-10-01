import { Skeleton } from "@/components/ui/skeleton";

/** Shown while a route segment streams in. Matches the dashboard rhythm. */
export default function Loading() {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">Loading page…</span>
      <Skeleton className="mb-2 h-8 w-56" />
      <Skeleton className="mb-6 h-4 w-80 max-w-full" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <Skeleton className="mt-6 h-72" />
    </div>
  );
}
