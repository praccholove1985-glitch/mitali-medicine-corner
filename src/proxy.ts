import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { updateSession } from "@/lib/supabase/proxy-session";

const PUBLIC_PATHS = new Set(["/login", "/setup"]);

/**
 * Optimistic gate only: it keeps signed-out visitors off app pages and refreshes
 * the session cookie. It is NOT the authorisation layer. Every page re-checks the
 * session on the server and the database enforces permissions with RLS.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const env = getSupabaseEnv();

  const isApi = pathname.startsWith("/api/");

  if (!env) {
    if (pathname === "/setup") return NextResponse.next();
    if (isApi) return apiError(503, "UNAVAILABLE", "The database connection is not configured.");
    return NextResponse.redirect(new URL("/setup", request.url));
  }

  if (pathname === "/setup") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const { response, user } = await updateSession(request, env);

  if (!user && isApi) {
    return apiError(401, "UNAUTHENTICATED", "Your session has ended. Sign in again.");
  }

  if (!user && !PUBLIC_PATHS.has(pathname)) {
    const loginUrl = new URL("/login", request.url);
    if (pathname !== "/") loginUrl.searchParams.set("next", pathname + search);
    return redirectKeepingCookies(loginUrl, response);
  }

  if (user && pathname === "/login") {
    return redirectKeepingCookies(new URL("/", request.url), response);
  }

  return response;
}

/** API callers get JSON, not an HTML redirect to the login page. */
function apiError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

/** A redirect must carry any cookies the session refresh just set. */
function redirectKeepingCookies(url: URL, from: NextResponse) {
  const redirect = NextResponse.redirect(url);
  for (const cookie of from.cookies.getAll()) {
    redirect.cookies.set(cookie);
  }
  return redirect;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
