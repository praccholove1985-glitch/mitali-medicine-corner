import { formatMoney } from "@/domain/money";
import { cn } from "@/lib/utils";

type MoneyTextProps = {
  /** Decimal string from the database, e.g. "1234.50". Never a JS number. */
  amount: string | null | undefined;
  fractionDigits?: number;
  className?: string;
};

/** Renders a dash (and "Not reported" to screen readers) when there is no value. */
function MoneyText({ amount, fractionDigits, className }: MoneyTextProps) {
  const formatted = formatMoney(amount, { fractionDigits });
  if (formatted === null) {
    return (
      <span className={cn("tabular text-muted-foreground", className)}>
        <span aria-hidden>—</span>
        <span className="sr-only">Not reported</span>
      </span>
    );
  }
  return <span className={cn("tabular", className)}>{formatted}</span>;
}

export { MoneyText };
