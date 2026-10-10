import * as React from "react";
import { cn } from "@/lib/utils";
import { getLocale } from "@/lib/locale";
import { localizeText } from "@/lib/i18n";

type PageHeaderProps = {
  title: string;
  description?: React.ReactNode;
  /** Small label above the title, e.g. the module group. */
  eyebrow?: string;
  /** Right-aligned actions; wraps below the title on narrow screens. */
  actions?: React.ReactNode;
  className?: string;
};

async function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  className,
}: PageHeaderProps) {
  const locale = await getLocale();
  const displayTitle = localizeText(locale, title);
  const displayEyebrow = eyebrow ? localizeText(locale, eyebrow) : undefined;
  const displayDescription = typeof description === "string" ? localizeText(locale, description) : description;
  return (
    <header
      className={cn(
        "flex flex-col gap-3 pb-5 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-xs font-semibold tracking-wide text-primary-text uppercase">
            {displayEyebrow}
          </p>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {displayTitle}
        </h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {displayDescription}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </header>
  );
}

export { PageHeader };
