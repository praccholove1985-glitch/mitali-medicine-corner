import { cartItemsSchema } from "@/lib/validation/sale";
import { quoteSale } from "@/server/db/pos";
import { failure, json, posSession } from "@/server/pos-api";

/** Prices the cart on the server (nothing is written or locked). */
export async function POST(request: Request) {
  const auth = await posSession();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: { code: "INVALID", message: "That request wasn't understood." } }, 400);
  }
  const items = cartItemsSchema.safeParse((body as { items?: unknown } | null)?.items);
  if (!items.success) {
    return json({ error: { code: "INVALID", message: items.error.issues[0]?.message ?? "Check the cart and try again." } }, 400);
  }

  try {
    const result = await quoteSale(auth.branchId, items.data);
    if (!result.ok) return json({ error: result.failure }, 422);
    return json({ quote: result.quote });
  } catch (error) {
    return failure(error);
  }
}
