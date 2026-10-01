import { uuidLike } from "@/lib/validation/common";
import { posBatches } from "@/server/db/pos";
import { failure, json, posSession } from "@/server/pos-api";

export async function GET(request: Request) {
  const auth = await posSession();
  if (!auth.ok) return auth.response;
  const medicine = uuidLike.safeParse(new URL(request.url).searchParams.get("medicine") ?? "");
  if (!medicine.success) return json({ error: { code: "INVALID", message: "Choose a medicine." } }, 400);
  try {
    return json({ items: await posBatches(auth.branchId, medicine.data) });
  } catch (error) {
    return failure(error);
  }
}
