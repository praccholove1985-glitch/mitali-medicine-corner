"use server";

import { cookies } from "next/headers";
import type { Locale } from "@/lib/i18n";

export async function setAppLanguage(locale: Locale): Promise<void> {
  if (locale !== "en" && locale !== "bn") return;
  const store = await cookies();
  store.set("mmc-locale", locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
  });
}
