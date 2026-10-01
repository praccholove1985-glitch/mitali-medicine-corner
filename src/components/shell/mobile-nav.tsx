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

/** Drawer navigation for phones. Focus is trapped and Esc closes it. */
export function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden">
          <Menu className="size-5" aria-hidden />
          <span className="sr-only">Open navigation</span>
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <SheetDescription className="sr-only">
          Move between sections of the pharmacy system.
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
          <NavList variant="full" onNavigate={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
