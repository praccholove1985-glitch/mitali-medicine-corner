import { LogOut, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signOut } from "@/app/login/actions";
import type { Role } from "@/types/session";
import type { Locale } from "@/lib/i18n";

const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Admin",
  MANAGER: "Manager",
  PHARMACIST: "Pharmacist",
  CASHIER: "Cashier",
  STAFF: "Staff",
};

type UserMenuProps = {
  name: string;
  email: string | null;
  role: Role;
  locale: Locale;
};

/** Who is signed in, their role, and a sign-out button. */
export function UserMenu({ name, email, role, locale }: UserMenuProps) {
  const roles: Record<Role, string> = locale === "bn"
    ? { ADMIN: "প্রশাসক", MANAGER: "ম্যানেজার", PHARMACIST: "ফার্মাসিস্ট", CASHIER: "ক্যাশিয়ার", STAFF: "কর্মী" }
    : ROLE_LABEL;
  const display = name.trim() || email || (locale === "bn" ? "সাইন ইন করা" : "Signed in");
  return (
    <div className="flex items-center gap-1">
      <div className="flex h-10 items-center gap-2 rounded-md border bg-card pr-3 pl-1.5">
        <span className="flex size-7 items-center justify-center rounded-full bg-primary-soft text-primary-text">
          <UserRound className="size-4" aria-hidden />
        </span>
        <span className="hidden max-w-40 flex-col leading-tight md:flex">
          <span className="truncate text-xs font-medium text-foreground">{display}</span>
          <span className="text-[11px] text-muted-foreground">{roles[role]}</span>
        </span>
        <span className="sr-only md:hidden">
          {display}, {roles[role]}
        </span>
      </div>
      <form action={signOut}>
        <Button type="submit" variant="ghost" size="icon" title={locale === "bn" ? "সাইন আউট" : "Sign out"}>
          <LogOut className="size-5" aria-hidden />
          <span className="sr-only">{locale === "bn" ? "সাইন আউট" : "Sign out"}</span>
        </Button>
      </form>
    </div>
  );
}
