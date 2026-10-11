import Image from "next/image";
import { cn } from "@/lib/utils";

/** Mitali Medicine Corner's supplied brand mark. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <Image
      src="/mitali-logo.png"
      alt=""
      aria-hidden="true"
      width={96}
      height={96}
      priority
      className={cn("size-8 shrink-0 object-contain", className)}
    />
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
