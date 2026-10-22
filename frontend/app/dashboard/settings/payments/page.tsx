import type { Metadata } from "next";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { PaymentSettingsPage } from "@/features/payments/components/payment-settings";

// Rendered client-side after the session check; nothing to validate as an instant navigation.
export const instant = false;
export const metadata: Metadata = { title: "Payment settings" };

export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <PaymentSettingsPage />
    </Suspense>
  );
}
