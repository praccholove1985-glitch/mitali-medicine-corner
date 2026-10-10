"use client";

import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MobileNav } from "@/components/shell/mobile-nav";
import { ConnectionIndicator } from "@/components/shell/connection-indicator";
import { LanguageToggle } from "@/components/shell/language-toggle";
import { UserMenu } from "@/components/shell/user-menu";
import { t, type Locale } from "@/lib/i18n";
import type { Role } from "@/types/session";

type TopbarProps = {
  permissions: readonly string[];
  locale: Locale;
  user: { name: string; email: string | null; role: Role };
};

export function Topbar({ permissions, user, locale }: TopbarProps) {
  const canSell = permissions.includes("sale.create");
  const canSearch = permissions.includes("medicine.view");
  return (
    <div className="sticky top-0 z-20 flex h-16 print:hidden items-center gap-2 border-b bg-card px-3 sm:gap-3 sm:px-6">
      <MobileNav permissions={permissions} locale={locale} />

      <form action="/medicines" role="search" className="relative min-w-0 max-w-md flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          type="search"
          name="q"
          disabled={!canSearch}
          aria-label={canSearch ? t(locale, "top.search") : t(locale, "top.searchDisabled")}
          placeholder={t(locale, "top.search")}
          className="bg-muted pl-9 shadow-none"
          autoComplete="off"
        />
      </form>

      <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
        <LanguageToggle locale={locale} />
        <ConnectionIndicator />
        {canSell ? (
          <>
            <Button asChild size="md" className="hidden sm:inline-flex">
              <Link href="/pos"><Plus aria-hidden />{t(locale, "top.newSale")}</Link>
            </Button>
            <Button asChild size="icon" className="sm:hidden">
              <Link href="/pos"><Plus aria-hidden /><span className="sr-only">{t(locale, "top.mobileNewSale")}</span></Link>
            </Button>
          </>
        ) : null}
        <UserMenu name={user.name} email={user.email} role={user.role} locale={locale} />
      </div>
    </div>
  );
}
