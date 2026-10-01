import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Settings2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { getSupabaseEnv } from "@/lib/supabase/env";

export const metadata: Metadata = { title: "Setup required" };

// Read at request time, never cached from build.
export const dynamic = "force-dynamic";

/** Shown instead of the app when the Supabase connection is not configured. */
export default function SetupPage() {
  if (getSupabaseEnv()) redirect("/");

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <Card className="w-full max-w-lg">
        <EmptyState
          size="page"
          icon={Settings2}
          title="Connect the database to continue"
          description="The app can't start without its Supabase connection. Add the two variables below to the environment and restart."
        />
        <div className="border-t px-6 py-4">
          <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Required variables
          </p>
          <ul className="flex flex-col gap-1.5 font-mono text-xs">
            <li className="rounded bg-muted px-2 py-1.5">NEXT_PUBLIC_SUPABASE_URL</li>
            <li className="rounded bg-muted px-2 py-1.5">NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</li>
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            Both come from Project settings → API in the Supabase dashboard. See{" "}
            <span className="font-mono">.env.example</span>. Never use a service-role key here.
          </p>
        </div>
      </Card>
    </main>
  );
}
