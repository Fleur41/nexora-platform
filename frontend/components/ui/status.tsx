import { LEASE_STATUS, UNIT_STATUS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import type { LeaseStatus, UnitStatus } from "@/types/api";

import { Badge } from "./badge";

export function UnitStatusBadge({ status, className }: { status: UnitStatus; className?: string }) {
  const s = UNIT_STATUS[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        s.tile,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", s.dot)} aria-hidden />
      {s.label}
    </span>
  );
}

export function LeaseStatusBadge({ status }: { status: LeaseStatus }) {
  const s = LEASE_STATUS[status];
  return <Badge variant={s.variant}>{s.label}</Badge>;
}
