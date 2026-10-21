import type { Metadata } from "next";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { TenantsPage } from "@/features/tenants/components/tenants-page";

export const metadata: Metadata = { title: "Tenants" };

export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <TenantsPage />
    </Suspense>
  );
}
