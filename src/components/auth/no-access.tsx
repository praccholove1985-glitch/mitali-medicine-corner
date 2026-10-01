import { LockKeyhole, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { signOut } from "@/app/login/actions";
import type { SessionUser } from "@/types/session";

/**
 * Signed in, but not a member of any active branch. A new sign-up lands here
 * until the owner adds them; the database grants such an account nothing.
 */
export function NoAccess({ user }: { user: SessionUser }) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <EmptyState
          size="page"
          icon={LockKeyhole}
          title="Your account has no access yet"
          description={
            <>
              {user.email ? (
                <>
                  You&rsquo;re signed in as <span className="font-medium text-foreground">{user.email}</span>, but{" "}
                </>
              ) : (
                <>You&rsquo;re signed in, but </>
              )}
              you haven&rsquo;t been added to the pharmacy. Ask the shop owner to give you a role.
            </>
          }
          action={
            <form action={signOut}>
              <Button type="submit" variant="outline">
                <LogOut aria-hidden />
                Sign out
              </Button>
            </form>
          }
        />
      </Card>
    </main>
  );
}
