import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { Card, CardDescription, CardHeader } from "./card";
import { Skeleton } from "./skeleton";

export function Stat({
  icon: Icon,
  label,
  value,
  hint,
  loading,
  href,
}: {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  hint?: string;
  loading?: boolean;
  href?: string;
}) {
  const body = (
    <Card className="h-full transition-shadow group-hover:shadow-md">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardDescription>{label}</CardDescription>
          <Icon className="size-4 text-muted-foreground" aria-hidden />
        </div>
        {loading ? (
          <Skeleton className="h-8 w-20" />
        ) : (
          <p className="text-3xl font-semibold tracking-tight">{value}</p>
        )}
        {hint && !loading && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardHeader>
    </Card>
  );
  return href ? (
    <Link
      href={href}
      className="group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {body}
    </Link>
  ) : (
    body
  );
}
