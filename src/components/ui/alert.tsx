import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const alertVariants = cva("flex gap-3 rounded-lg border px-4 py-3 text-sm", {
  variants: {
    tone: {
      info: "border-accent/40 bg-accent-soft text-foreground",
      success: "border-success/40 bg-success-soft text-success-text",
      warning: "border-warning/50 bg-warning-soft text-warning-text",
      danger: "border-danger/40 bg-danger-soft text-danger-text",
    },
  },
  defaultVariants: { tone: "info" },
});

const icons = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
} as const;

type AlertProps = Omit<React.ComponentProps<"div">, "title"> &
  VariantProps<typeof alertVariants> & { title?: React.ReactNode };

/** Icon + text, never colour alone. Danger/warning announce themselves. */
function Alert({ className, tone = "info", title, children, ...props }: AlertProps) {
  const Icon = icons[tone ?? "info"];
  return (
    <div
      role={tone === "danger" || tone === "warning" ? "alert" : "status"}
      className={cn(alertVariants({ tone }), className)}
      {...props}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={title ? "mt-0.5" : undefined}>{children}</div> : null}
      </div>
    </div>
  );
}

export { Alert };
