import * as React from "react";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import type { Role } from "@/types/session";

type AppShellProps = {
  children: React.ReactNode;
  permissions: readonly string[];
  branchName: string;
  user: { name: string; email: string | null; role: Role };
};

export function AppShell({ children, permissions, branchName, user }: AppShellProps) {
  return (
    <div className="min-h-dvh">
      <a
        href="#main-content"
        className="sr-only z-50 print:hidden rounded-md bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to main content
      </a>
      <Sidebar permissions={permissions} branchName={branchName} />
      <div className="flex min-h-dvh flex-col md:pl-16 lg:pl-64 print:block print:pl-0">
        <Topbar permissions={permissions} user={user} />
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 outline-none sm:px-6 print:max-w-none print:p-0"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
