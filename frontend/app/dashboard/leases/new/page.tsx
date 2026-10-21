import type { Metadata } from "next";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { LeaseForm } from "@/features/leases/components/lease-form";

export const metadata: Metadata = { title: "New lease" };

export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <LeaseForm />
    </Suspense>
  );
}
