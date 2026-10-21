import type { Metadata } from "next";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { TenantDetail } from "@/features/tenants/components/tenant-detail";

export const metadata: Metadata = { title: "Tenant" };

export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <TenantDetail />
    </Suspense>
  );
}
