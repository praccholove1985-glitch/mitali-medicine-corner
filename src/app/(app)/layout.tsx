import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { NoAccess } from "@/components/auth/no-access";
import { getSessionContext } from "@/server/session";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await getSessionContext();

  // The proxy already redirects, but access is decided here as well: never rely
  // on the proxy alone.
  if (session.status === "unconfigured") redirect("/setup");
  if (session.status === "anonymous") redirect("/login");
  if (session.status === "no_access") return <NoAccess user={session.user} />;

  return (
    <AppShell
      permissions={session.permissions}
      branchName={session.branch.name}
      user={{ name: session.user.fullName, email: session.user.email, role: session.role }}
    >
      {children}
    </AppShell>
  );
}
