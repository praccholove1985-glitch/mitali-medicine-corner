import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getLocale } from "@/lib/locale";
import { localizeText } from "@/lib/i18n";

type PaginationLinksProps = {
  page: number;
  pageSize: number;
  total: number;
  /** Builds the URL for a page number, keeping the other filters. */
  hrefFor: (page: number) => string;
};

/** Server-rendered pagination: plain links, so it works without client JavaScript. */
export async function PaginationLinks({ page, pageSize, total, hrefFor }: PaginationLinksProps) {
  const locale = await getLocale();
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const disabled = "pointer-events-none opacity-50";

  return (
    <nav aria-label={locale === "bn" ? "পৃষ্ঠা চলাচল" : "Pagination"} className="flex items-center justify-between gap-3 border-t px-4 py-3">
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {total === 0 ? localizeText(locale, "No results") : locale === "bn" ? `${from.toLocaleString("bn-BD")}–${to.toLocaleString("bn-BD")} এর ${total.toLocaleString("bn-BD")}` : `${from}–${to} of ${total}`}
      </p>
      <div className="flex gap-2">
        <Link
          href={hrefFor(Math.max(1, page - 1))}
          aria-disabled={page <= 1}
          tabIndex={page <= 1 ? -1 : undefined}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), page <= 1 && disabled)}
        >
          <ChevronLeft aria-hidden />
          {localizeText(locale, "Previous")}
        </Link>
        <Link
          href={hrefFor(Math.min(pageCount, page + 1))}
          aria-disabled={page >= pageCount}
          tabIndex={page >= pageCount ? -1 : undefined}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), page >= pageCount && disabled)}
        >
          {localizeText(locale, "Next")}
          <ChevronRight aria-hidden />
        </Link>
      </div>
    </nav>
  );
}
