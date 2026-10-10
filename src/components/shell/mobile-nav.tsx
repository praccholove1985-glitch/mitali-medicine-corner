"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { BrandMark, BrandName } from "@/components/shell/brand";
import { NavList } from "@/components/shell/nav-list";
import type { Locale } from "@/lib/i18n";
import { t } from "@/lib/i18n";

/** Drawer navigation for phones. Focus is trapped and Esc closes it. */
export function MobileNav({ permissions, locale }: { permissions: readonly string[]; locale: Locale }) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden">
          <Menu className="size-5" aria-hidden />
          <span className="sr-only">{locale === "bn" ? "মেনু খুলুন" : "Open navigation"}</span>
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetTitle className="sr-only">{locale === "bn" ? "নেভিগেশন" : "Navigation"}</SheetTitle>
        <SheetDescription className="sr-only">
          {locale === "bn" ? "ফার্মেসি সিস্টেমের বিভিন্ন অংশে যান।" : "Move between sections of the pharmacy system."}
        </SheetDescription>
        <Link
          href="/"
          onClick={() => setOpen(false)}
          className="flex h-16 shrink-0 items-center gap-3 px-5"
        >
          <BrandMark />
          <BrandName />
        </Link>
        <div className="flex-1 overflow-y-auto pt-2">
          <NavList variant="full" permissions={permissions} locale={locale} onNavigate={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
