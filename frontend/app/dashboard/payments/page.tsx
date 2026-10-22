import type { Metadata } from "next";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { PaymentsPage } from "@/features/payments/components/payments-page";

// Rendered client-side after the session check; nothing to validate as an instant navigation.
export const instant = false;
export const metadata: Metadata = { title: "Payments" };

export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <PaymentsPage />
    </Suspense>
  );
}
