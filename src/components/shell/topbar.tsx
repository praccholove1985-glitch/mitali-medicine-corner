import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MobileNav } from "@/components/shell/mobile-nav";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { ConnectionIndicator } from "@/components/shell/connection-indicator";
import { UserMenu } from "@/components/shell/user-menu";
import type { Role } from "@/types/session";

type TopbarProps = {
  permissions: readonly string[];
  user: { name: string; email: string | null; role: Role };
};

export function Topbar({ permissions, user }: TopbarProps) {
  const canSell = permissions.includes("sale.create");
  return (
    <div className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b bg-card/95 px-3 backdrop-blur sm:gap-3 sm:px-6">
      <MobileNav permissions={permissions} />

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
        {canSell ? (
          <>
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
          </>
        ) : null}
        <UserMenu name={user.name} email={user.email} role={user.role} />
      </div>
    </div>
  );
}
