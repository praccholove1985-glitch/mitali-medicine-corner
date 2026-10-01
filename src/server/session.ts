import "server-only";
import { cache } from "react";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { mapError } from "@/server/errors";
import type { Role, SessionContext } from "@/types/session";

const ROLES: readonly Role[] = ["ADMIN", "MANAGER", "PHARMACIST", "CASHIER", "STAFF"];

function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export class SessionLoadError extends Error {
  constructor(
    public readonly reference: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "SessionLoadError";
  }
}

/**
 * Who is signed in, which branch they act in and what they may do. Cached for
 * the duration of a request, so layouts and pages can all call it.
 *
 * Identity comes from `auth.getUser()` (validated by the Auth server). Branch
 * and permission data come from queries that run as the user, so RLS decides
 * what they can see. The permission list only shapes the UI; every write is
 * re-authorised by the database.
 */
export const getSessionContext = cache(async (): Promise<SessionContext> => {
  // Per-user data must never be prerendered or cached at build time, even when
  // the environment is empty and no cookie is read below.
  await connection();

  const supabase = await createClient();
  if (!supabase) return { status: "unconfigured" };

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    // "No session" is the normal signed-out case, not a failure.
    if (!userError || userError.name === "AuthSessionMissingError") {
      return { status: "anonymous" };
    }
    const mapped = mapError(userError, "session.getUser");
    if (mapped.code === "UNAUTHENTICATED") return { status: "anonymous" };
    throw new SessionLoadError(mapped.reference, mapped.message);
  }
  const authUser = userData.user;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("full_name, is_active")
    .eq("id", authUser.id)
    .maybeSingle();
  if (profileError) {
    const mapped = mapError(profileError, "session.profile");
    throw new SessionLoadError(mapped.reference, mapped.message);
  }

  const user = {
    id: authUser.id,
    email: authUser.email ?? null,
    fullName: profile?.full_name ?? "",
  };
  if (!profile || !profile.is_active) return { status: "no_access", user };

  const { data: memberships, error: membershipError } = await supabase
    .from("branch_members")
    .select("branch_id, role")
    .eq("user_id", authUser.id)
    .eq("is_active", true);
  if (membershipError) {
    const mapped = mapError(membershipError, "session.memberships");
    throw new SessionLoadError(mapped.reference, mapped.message);
  }
  if (!memberships || memberships.length === 0) return { status: "no_access", user };

  const { data: branches, error: branchError } = await supabase
    .from("branches")
    .select("id, name, timezone, currency")
    .in(
      "id",
      memberships.map((m) => m.branch_id),
    )
    .eq("is_active", true)
    .order("name");
  if (branchError) {
    const mapped = mapError(branchError, "session.branches");
    throw new SessionLoadError(mapped.reference, mapped.message);
  }
  // RLS hides inactive branches, so an empty list means no usable access.
  const branch = branches?.[0];
  if (!branch) return { status: "no_access", user };

  const membership = memberships.find((m) => m.branch_id === branch.id);
  if (!membership || !isRole(membership.role)) return { status: "no_access", user };

  const { data: permissions, error: permissionError } = await supabase.rpc("my_permissions", {
    p_branch: branch.id,
  });
  if (permissionError) {
    const mapped = mapError(permissionError, "session.permissions");
    throw new SessionLoadError(mapped.reference, mapped.message);
  }

  return {
    status: "ready",
    user,
    branch,
    branchCount: branches?.length ?? 1,
    role: membership.role,
    permissions: Array.isArray(permissions) ? permissions.map(String) : [],
  };
});
