import type { Metadata } from "next";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { LeaseDetail } from "@/features/leases/components/lease-detail";

export const metadata: Metadata = { title: "Lease" };

export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <LeaseDetail />
    </Suspense>
  );
}
