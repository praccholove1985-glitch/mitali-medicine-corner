import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import type { SupabaseEnv } from "@/lib/supabase/env";

/**
 * Refreshes the Supabase session cookie for this request and reports who is
 * signed in. `getUser()` asks the Auth server to validate the token; it is not
 * a decode of the cookie, so a forged cookie does not authenticate.
 */
export async function updateSession(
  request: NextRequest,
  env: SupabaseEnv,
): Promise<{ response: NextResponse; user: User | null }> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(env.url, env.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  let user: User | null = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    // Auth server unreachable: treat as signed out rather than throwing.
    user = null;
  }

  return { response, user };
}
