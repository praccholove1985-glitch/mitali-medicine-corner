import Link from "next/link";
import { BrandMark, BrandName } from "@/components/shell/brand";
import { NavList } from "@/components/shell/nav-list";

type SidebarProps = {
  permissions: readonly string[];
  branchName: string;
};

/** Fixed rail on tablet (icons), full sidebar on desktop. Hidden on phones. */
export function Sidebar({ permissions, branchName }: SidebarProps) {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-16 flex-col border-r border-sidebar-border bg-sidebar md:flex lg:w-64">
      <Link
        href="/"
        aria-label="Mitali Medicine Corner, dashboard"
        className="flex h-16 shrink-0 items-center justify-center gap-3 px-4 lg:justify-start"
      >
        <BrandMark />
        <BrandName compact />
      </Link>
      <div className="flex-1 overflow-y-auto pt-2">
        <NavList variant="rail" permissions={permissions} />
      </div>
      <p
        className="hidden truncate border-t border-sidebar-border px-5 py-3 text-xs text-sidebar-muted lg:block"
        title={branchName}
      >
        {branchName}
      </p>
    </aside>
  );
}
