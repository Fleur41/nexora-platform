import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

const ICONS = { error: AlertCircle, success: CheckCircle2, info: Info };
const STYLES = {
  error: "border-destructive/30 bg-destructive/5 text-destructive",
  success: "border-accent/30 bg-accent/10 text-accent-strong",
  info: "border-primary/20 bg-primary/5 text-primary",
};

export function Alert({
  variant = "info",
  title,
  children,
  className,
}: {
  variant?: keyof typeof ICONS;
  title?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const Icon = ICONS[variant];
  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      className={cn("flex gap-3 rounded-lg border p-4 text-sm", STYLES[variant], className)}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="space-y-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className="opacity-90">{children}</div>}
      </div>
    </div>
  );
}
