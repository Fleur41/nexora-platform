import type { Metadata } from "next";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { UnitsPage } from "@/features/properties/components/units-page";

export const metadata: Metadata = { title: "Units" };

export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <UnitsPage />
    </Suspense>
  );
}
