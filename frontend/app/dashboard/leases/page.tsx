import type { Metadata } from "next";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { LeasesPage } from "@/features/leases/components/leases-page";

export const metadata: Metadata = { title: "Leases" };

export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <LeasesPage />
    </Suspense>
  );
}
