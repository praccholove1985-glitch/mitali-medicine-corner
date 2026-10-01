import { searchCustomers } from "@/server/db/pos";
import { failure, json, posSession } from "@/server/pos-api";

export async function GET(request: Request) {
  const auth = await posSession("customer.view");
  if (!auth.ok) return auth.response;
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 60);
  try {
    return json({ items: await searchCustomers(auth.branchId, q, 10) });
  } catch (error) {
    return failure(error);
  }
}
