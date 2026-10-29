import type { Metadata } from "next";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { PublicListings } from "@/features/listings/components/public-listings";

export const metadata: Metadata = {
  title: "Homes to let",
  description: "Houses and apartments to let from landlords using Nexora. Book a viewing in a minute.",
};

export default function Page() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-6xl px-4 py-10"><Skeleton className="h-96 w-full" /></div>}>
      <PublicListings />
    </Suspense>
  );
}
