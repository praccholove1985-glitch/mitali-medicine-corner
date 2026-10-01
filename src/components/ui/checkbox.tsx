import * as React from "react";
import { cn } from "@/lib/utils";

type CheckboxProps = Omit<React.ComponentProps<"input">, "type"> & {
  label: string;
  hint?: string;
};

/** Native checkbox with a 44px-friendly label target; label and hint are wired for screen readers. */
function Checkbox({ label, hint, id, className, ...props }: CheckboxProps) {
  const hintId = hint && id ? `${id}-hint` : undefined;
  return (
    <div className={cn("flex items-start gap-3", className)}>
      <input
        type="checkbox"
        id={id}
        aria-describedby={hintId}
        className="mt-0.5 size-5 shrink-0 cursor-pointer rounded border border-input accent-primary"
        {...props}
      />
      <div className="flex flex-col">
        <label htmlFor={id} className="cursor-pointer text-sm font-medium text-foreground">
          {label}
        </label>
        {hint ? (
          <span id={hintId} className="text-xs text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export { Checkbox };
