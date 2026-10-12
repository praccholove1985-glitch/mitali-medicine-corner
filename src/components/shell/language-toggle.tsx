"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Languages } from "lucide-react";
import { setAppLanguage } from "@/app/language-actions";
import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function LanguageToggle({ locale }: { locale: Locale }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function changeLanguage(nextLocale: Locale) {
    if (nextLocale === locale || pending) return;
    startTransition(async () => {
      await setAppLanguage(nextLocale);
      router.refresh();
    });
  }

  return (
    <div role="group" aria-label={locale === "bn" ? "ভাষা নির্বাচন" : "Choose language"} className="inline-flex h-9 shrink-0 items-center gap-0.5 rounded-lg border border-border bg-muted/70 p-0.5">
      <Languages className="ml-2 mr-1 size-4 text-muted-foreground" aria-hidden />
      <button type="button" onClick={() => changeLanguage("en")} disabled={pending} aria-pressed={locale === "en"} className={cn("h-7 rounded-md px-2 text-xs font-semibold transition-colors disabled:opacity-60", locale === "en" ? "bg-white text-primary-text shadow-sm" : "text-muted-foreground hover:text-foreground")}>EN</button>
      <button type="button" onClick={() => changeLanguage("bn")} disabled={pending} aria-pressed={locale === "bn"} className={cn("h-7 rounded-md px-2 text-xs font-semibold transition-colors disabled:opacity-60", locale === "bn" ? "bg-white text-primary-text shadow-sm" : "text-muted-foreground hover:text-foreground")}>বাংলা</button>
    </div>
  );
}
