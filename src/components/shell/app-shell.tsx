import * as React from "react";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import type { Role } from "@/types/session";
import type { Locale } from "@/lib/i18n";
import { t } from "@/lib/i18n";

type AppShellProps = {
  children: React.ReactNode;
  locale: Locale;
  permissions: readonly string[];
  branchName: string;
  user: { name: string; email: string | null; role: Role };
};

export function AppShell({ children, permissions, branchName, user, locale }: AppShellProps) {
  return (
    <div className="min-h-dvh">
      <a
        href="#main-content"
        className="sr-only z-50 print:hidden rounded-md bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        {t(locale, "shell.skip")}
      </a>
      <Sidebar permissions={permissions} branchName={branchName} locale={locale} />
      <div className="flex min-h-dvh flex-col md:pl-16 lg:pl-64 print:block print:pl-0">
        <Topbar permissions={permissions} user={user} locale={locale} />
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
