"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";

/**
 * Debounced search that writes `q` to the URL, so the server re-queries and the
 * result is shareable. Barcode scanners type the code and press Enter: Enter
 * searches immediately.
 */
export function MedicineSearchBox({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(initialQuery);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function navigate(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.trim()) params.set("q", next.trim());
    else params.delete("q");
    params.delete("page");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  function onChange(next: string) {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => navigate(next), 250);
  }

  return (
    <form
      role="search"
      className="relative w-full max-w-md"
      onSubmit={(event) => {
        event.preventDefault();
        if (timer.current) clearTimeout(timer.current);
        navigate(value);
      }}
    >
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label="Search medicines by name, generic, brand, company, barcode or SKU"
        placeholder="Search name, generic, company, barcode or SKU"
        className="pr-9 pl-9"
        autoComplete="off"
        spellCheck={false}
      />
      {value ? (
        <button
          type="button"
          onClick={() => {
            setValue("");
            navigate("");
          }}
          className="absolute top-1/2 right-2 flex size-7 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-muted"
        >
          <X className="size-4" aria-hidden />
          <span className="sr-only">Clear search</span>
        </button>
      ) : null}
    </form>
  );
}
