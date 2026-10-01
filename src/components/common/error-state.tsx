import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ErrorStateProps = {
  title?: string;
  /** A user-facing sentence. Never pass a raw database or exception message. */
  message?: string;
  /** Correlation id (e.g. Next.js error digest) so support can find the log. */
  reference?: string;
  onRetry?: () => void;
  retryLabel?: string;
  size?: "compact" | "page";
  className?: string;
};

function ErrorState({
  title = "Something went wrong",
  message = "We couldn't load this. Check your connection and try again.",
  reference,
  onRetry,
  retryLabel = "Try again",
  size = "compact",
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center text-center",
        size === "page" ? "px-6 py-16" : "px-4 py-10",
        className,
      )}
    >
      <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-danger-soft text-danger-text">
        <AlertTriangle className="size-6" aria-hidden />
      </div>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{message}</p>
      {reference ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Reference: <span className="font-mono">{reference}</span>
        </p>
      ) : null}
      {onRetry ? (
        <Button variant="outline" size="md" className="mt-4" onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}

export { ErrorState };
