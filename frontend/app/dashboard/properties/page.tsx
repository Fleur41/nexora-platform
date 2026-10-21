import type { Metadata } from "next";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { PropertiesPage } from "@/features/properties/components/properties-page";

export const metadata: Metadata = { title: "Properties" };

export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <PropertiesPage />
    </Suspense>
  );
}
