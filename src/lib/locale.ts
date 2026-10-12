import "server-only";
import { cookies } from "next/headers";
import type { Locale } from "@/lib/i18n";

export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  return store.get("mmc-locale")?.value === "bn" ? "bn" : "en";
}
