import { cn } from "@/lib/utils";

/** Original capsule-and-cross mark; no third-party artwork. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("size-8", className)}
      aria-hidden
      focusable="false"
    >
      <rect width="32" height="32" rx="8" fill="var(--primary)" />
      <rect x="13" y="7" width="6" height="18" rx="3" fill="#fff" />
      <rect x="7" y="13" width="18" height="6" rx="3" fill="#fff" />
      <rect x="13" y="13" width="6" height="6" fill="var(--accent)" />
    </svg>
  );
}

export function BrandName({ compact = false }: { compact?: boolean }) {
  return (
    <span className={cn("flex min-w-0 flex-col leading-tight", compact && "hidden lg:flex")}>
      <span className="truncate text-sm font-semibold text-sidebar-active-foreground">
        Mitali
      </span>
      <span className="truncate text-xs text-sidebar-muted">Medicine Corner</span>
    </span>
  );
}
