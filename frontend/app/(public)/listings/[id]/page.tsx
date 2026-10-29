import type { Metadata } from "next";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { PublicListingDetail } from "@/features/listings/components/public-listing-detail";

export const metadata: Metadata = { title: "Home to let" };

export default function Page() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-6xl px-4 py-10"><Skeleton className="h-96 w-full" /></div>}>
      <PublicListingDetail />
    </Suspense>
  );
}
