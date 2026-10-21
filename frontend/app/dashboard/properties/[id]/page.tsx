import type { Metadata } from "next";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { PropertyDetail } from "@/features/properties/components/property-detail";

export const metadata: Metadata = { title: "Property" };

export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <PropertyDetail />
    </Suspense>
  );
}
