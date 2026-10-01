import { listDrafts } from "@/server/db/pos";
import { failure, json, posSession } from "@/server/pos-api";

export async function GET() {
  const auth = await posSession();
  if (!auth.ok) return auth.response;
  try {
    return json({ items: await listDrafts(auth.branchId) });
  } catch (error) {
    return failure(error);
  }
}
