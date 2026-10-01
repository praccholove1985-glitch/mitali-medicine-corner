"use client";

import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { THEME_STORAGE_KEY } from "@/components/shell/theme-script";

/**
 * The icon is chosen by CSS from the data-theme attribute, so server and client
 * render identical markup and there is no hydration mismatch. The current theme
 * is only read at click time.
 */
export function ThemeToggle() {
  function toggle() {
    const root = document.documentElement;
    const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage unavailable: the theme still applies for this visit.
    }
  }

  return (
    <Button variant="ghost" size="icon" onClick={toggle}>
      <Sun className="hidden size-5 dark:block" aria-hidden />
      <Moon className="size-5 dark:hidden" aria-hidden />
      <span className="sr-only">Toggle light and dark theme</span>
    </Button>
  );
}
