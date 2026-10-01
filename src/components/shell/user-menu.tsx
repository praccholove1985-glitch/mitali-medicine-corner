import { LogOut, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signOut } from "@/app/login/actions";
import type { Role } from "@/types/session";

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
};

/** Who is signed in, their role, and a sign-out button. */
export function UserMenu({ name, email, role }: UserMenuProps) {
  const display = name.trim() || email || "Signed in";
  return (
    <div className="flex items-center gap-1">
      <div className="flex h-10 items-center gap-2 rounded-md border bg-card pr-3 pl-1.5">
        <span className="flex size-7 items-center justify-center rounded-full bg-primary-soft text-primary-text">
          <UserRound className="size-4" aria-hidden />
        </span>
        <span className="hidden max-w-40 flex-col leading-tight md:flex">
          <span className="truncate text-xs font-medium text-foreground">{display}</span>
          <span className="text-[11px] text-muted-foreground">{ROLE_LABEL[role]}</span>
        </span>
        <span className="sr-only md:hidden">
          {display}, {ROLE_LABEL[role]}
        </span>
      </div>
      <form action={signOut}>
        <Button type="submit" variant="ghost" size="icon" title="Sign out">
          <LogOut className="size-5" aria-hidden />
          <span className="sr-only">Sign out</span>
        </Button>
      </form>
    </div>
  );
}
