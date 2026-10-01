"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getNavGroups, isActive } from "@/config/navigation";
import { cn } from "@/lib/utils";

type NavListProps = {
  /** `rail` collapses labels to icons on tablet widths; `full` always shows them. */
  variant: "rail" | "full";
  /** Called after a link is chosen (closes the mobile drawer). */
  onNavigate?: () => void;
};

export function NavList({ variant, onNavigate }: NavListProps) {
  const pathname = usePathname();
  const rail = variant === "rail";

  return (
    <nav aria-label="Main" className="flex flex-col gap-5 px-2 pb-4">
      {getNavGroups().map((group) => (
        <div key={group.label}>
          <p
            className={cn(
              "px-3 pb-1.5 text-[11px] font-semibold tracking-wider text-sidebar-muted uppercase",
              rail && "hidden lg:block",
            )}
          >
            {group.label}
          </p>
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active = isActive(pathname, item.href);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    title={rail ? item.label : undefined}
                    className={cn(
                      "group flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors",
                      rail && "justify-center lg:justify-start",
                      active
                        ? "bg-sidebar-active text-sidebar-active-foreground"
                        : "text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-active-foreground",
                    )}
                  >
                    <Icon className="size-[18px] shrink-0" aria-hidden />
                    <span className={cn("min-w-0 flex-1 truncate", rail && "sr-only lg:not-sr-only")}>
                      {item.label}
                    </span>
                    {item.phase !== null ? (
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[10px] leading-none font-semibold",
                          active
                            ? "bg-white/20 text-sidebar-active-foreground"
                            : "bg-sidebar-hover text-sidebar-muted group-hover:bg-sidebar-border",
                          rail && "hidden lg:inline",
                        )}
                      >
                        <span className="sr-only">Planned for </span>P{item.phase}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
