import Link from "next/link";
import { Plus, Search, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MobileNav } from "@/components/shell/mobile-nav";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { ConnectionIndicator } from "@/components/shell/connection-indicator";

export function Topbar() {
  return (
    <div className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b bg-card/95 px-3 backdrop-blur sm:gap-3 sm:px-6">
      <MobileNav />

      {/* Search is a Phase 3 feature; shown disabled rather than faked. */}
      <div className="relative min-w-0 max-w-md flex-1">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          disabled
          aria-label="Search medicines, barcode or SKU (available in Phase 3)"
          placeholder="Search medicine, barcode or SKU"
          className="bg-muted pl-9 shadow-none"
        />
      </div>

      <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
        <ConnectionIndicator />
        <ThemeToggle />
        <Button asChild size="md" className="hidden sm:inline-flex">
          <Link href="/pos">
            <Plus aria-hidden />
            New sale
          </Link>
        </Button>
        <Button asChild size="icon" className="sm:hidden">
          <Link href="/pos">
            <Plus aria-hidden />
            <span className="sr-only">New sale</span>
          </Link>
        </Button>
        <div
          className="flex h-10 items-center gap-2 rounded-md border bg-card pr-3 pl-1.5"
          title="Sign-in arrives in Phase 1"
        >
          <span className="flex size-7 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <UserRound className="size-4" aria-hidden />
          </span>
          <span className="hidden flex-col leading-tight md:flex">
            <span className="text-xs font-medium text-foreground">Not signed in</span>
            <span className="text-[11px] text-muted-foreground">Phase 1</span>
          </span>
          <span className="sr-only md:hidden">Not signed in</span>
        </div>
      </div>
    </div>
  );
}
