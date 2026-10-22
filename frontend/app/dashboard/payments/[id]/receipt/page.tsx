import type { Metadata } from "next";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { Receipt } from "@/features/payments/components/receipt";

// Rendered client-side after the session check; nothing to validate as an instant navigation.
export const instant = false;
export const metadata: Metadata = { title: "Receipt" };

export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Receipt />
    </Suspense>
  );
}
