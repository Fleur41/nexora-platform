import type { Metadata } from "next";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { PaymentDetail } from "@/features/payments/components/payment-detail";

// Rendered client-side after the session check; nothing to validate as an instant navigation.
export const instant = false;
export const metadata: Metadata = { title: "Payment" };

export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <PaymentDetail />
    </Suspense>
  );
}
