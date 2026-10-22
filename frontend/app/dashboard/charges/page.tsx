import type { Metadata } from "next";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { ChargesPage } from "@/features/billing/components/charges-page";

// Rendered client-side after the session check; nothing to validate as an instant navigation.
export const instant = false;
export const metadata: Metadata = { title: "Charges" };

export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <ChargesPage />
    </Suspense>
  );
}
