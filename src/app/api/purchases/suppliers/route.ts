import { searchSuppliers } from "@/server/db/suppliers";
import { failure, json, posSession } from "@/server/pos-api";

export async function GET(request: Request) {
  const auth = await posSession("purchase.create");
  if (!auth.ok) return auth.response;
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 100);
  try {
    return json({ suppliers: await searchSuppliers(auth.branchId, q) });
  } catch (error) {
    return failure(error);
  }
}
