import "server-only";
import { loadSession } from "@/server/session";
import { DataError } from "@/server/db/medicines";

type Ready = { ok: true; branchId: string; permissions: string[] };
type Denied = { ok: false; response: Response };

const NO_STORE = { "Cache-Control": "no-store" };

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

/**
 * Route handlers answer with JSON, never a redirect. The proxy has already turned a
 * signed-out request into a 401; this re-checks the session and the permission,
 * because the proxy is only an optimistic gate. The database is the real one.
 */
export async function posSession(permission = "sale.create"): Promise<Ready | Denied> {
  const session = await loadSession();
  if (session.status !== "ready") {
    return { ok: false, response: json({ error: { code: "UNAUTHENTICATED", message: "Your session has ended. Sign in again." } }, 401) };
  }
  if (!session.permissions.includes(permission)) {
    return { ok: false, response: json({ error: { code: "FORBIDDEN", message: "You don't have permission to do that." } }, 403) };
  }
  return { ok: true, branchId: session.branch.id, permissions: session.permissions };
}

export function failure(error: unknown): Response {
  if (error instanceof DataError) {
    return json({ error: { code: "UNKNOWN", message: error.message, reference: error.reference } }, 500);
  }
  console.error(JSON.stringify({ level: "error", context: "pos.api", name: error instanceof Error ? error.name : null }));
  return json({ error: { code: "UNKNOWN", message: "Something went wrong. Try again." } }, 500);
}
