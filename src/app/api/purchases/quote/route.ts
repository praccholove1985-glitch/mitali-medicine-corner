import { quotePurchaseSchema } from "@/lib/validation/purchase";
import { quotePurchase } from "@/server/db/purchases";
import { failure, json, posSession } from "@/server/pos-api";

/** Prices the purchase on the server (nothing is written). */
export async function POST(request: Request) {
  const auth = await posSession("purchase.create");
  if (!auth.ok) return auth.response;
  if (!auth.permissions.includes("purchase.view_cost")) {
    return json({ error: { code: "FORBIDDEN", message: "You don't have permission to do that." } }, 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: { code: "INVALID", message: "That request wasn't understood." } }, 400);
  }
  const parsed = quotePurchaseSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: { code: "INVALID", message: parsed.error.issues[0]?.message ?? "Check the lines and try again." } }, 400);
  }

  try {
    const result = await quotePurchase(auth.branchId, parsed.data.supplierId, parsed.data.items);
    if (!result.ok) return json({ error: result.failure }, 422);
    return json({ quote: result.quote });
  } catch (error) {
    return failure(error);
  }
}
