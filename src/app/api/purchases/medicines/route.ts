import { searchPurchaseMedicines } from "@/server/db/purchases";
import { failure, json, posSession } from "@/server/pos-api";

export async function GET(request: Request) {
  const auth = await posSession("purchase.create");
  if (!auth.ok) return auth.response;
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 100);
  try {
    return json({ medicines: await searchPurchaseMedicines(auth.branchId, q) });
  } catch (error) {
    return failure(error);
  }
}
