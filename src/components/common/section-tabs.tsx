"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

type SectionTabsProps = {
  label: string;
  items: { href: string; label: string }[];
};

/** Tabs for sibling pages. Each tab is a real link, so back/forward and sharing work. */
export function SectionTabs({ label, items }: SectionTabsProps) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="mb-5 flex gap-1 overflow-x-auto border-b">
      {items.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
              active
                ? "border-primary text-primary-text"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
