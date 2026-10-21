import { cn } from "@/lib/utils";

/** Nexora mark: a stylised "N" built from two linked nodes, plus the wordmark. */
export function NexoraMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8", className)} aria-hidden>
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <path
        d="M9 23V9l14 14V9"
        fill="none"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-primary-foreground"
      />
      <circle cx="23" cy="9" r="2.6" className="fill-accent" />
    </svg>
  );
}

export function NexoraLogo({
  className,
  tone = "default",
}: {
  className?: string;
  tone?: "default" | "inverse";
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <NexoraMark />
      <span
        className={cn(
          "text-xl font-semibold tracking-tight",
          tone === "inverse" ? "text-white" : "text-primary",
        )}
      >
        Nexora
      </span>
    </span>
  );
}
