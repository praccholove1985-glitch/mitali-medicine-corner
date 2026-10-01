import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/login-form";
import { BrandMark } from "@/components/shell/brand";
import { safeNextPath } from "@/lib/safe-redirect";

export const metadata: Metadata = { title: "Sign in" };

type Props = { searchParams: Promise<{ next?: string | string[] }> };

export default async function LoginPage({ searchParams }: Props) {
  const { next } = await searchParams;
  const nextPath = safeNextPath(Array.isArray(next) ? next[0] : next);

  return (
    <main className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
      <section className="hidden flex-col justify-between bg-sidebar p-10 text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-3">
          <BrandMark className="size-10" />
          <div className="leading-tight">
            <p className="text-base font-semibold text-sidebar-active-foreground">Mitali</p>
            <p className="text-sm text-sidebar-muted">Medicine Corner</p>
          </div>
        </div>
        <div className="max-w-md">
          <h1 className="text-3xl font-semibold tracking-tight text-sidebar-active-foreground">
            Every batch, every expiry, every taka accounted for.
          </h1>
          <p className="mt-3 text-sm text-sidebar-muted">
            Point of sale, stock and accounts for the pharmacy counter.
          </p>
        </div>
        <p className="text-xs text-sidebar-muted">Authorised staff only.</p>
      </section>

      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <BrandMark className="size-10" />
            <div className="leading-tight">
              <p className="text-base font-semibold text-foreground">Mitali</p>
              <p className="text-sm text-muted-foreground">Medicine Corner</p>
            </div>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">Sign in</h2>
          <p className="mt-1 mb-6 text-sm text-muted-foreground">
            Use the account the shop owner created for you.
          </p>
          <LoginForm next={nextPath} />
        </div>
      </section>
    </main>
  );
}
