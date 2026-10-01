import { posSearch } from "@/server/db/pos";
import { failure, json, posSession } from "@/server/pos-api";

export async function GET(request: Request) {
  const auth = await posSession();
  if (!auth.ok) return auth.response;
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 100);
  try {
    return json({ items: await posSearch(auth.branchId, q, 20) });
  } catch (error) {
    return failure(error);
  }
}
