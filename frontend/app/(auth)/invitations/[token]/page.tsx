import type { Metadata } from "next";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { AcceptInvitation } from "@/features/organizations/components/accept-invitation";

export const metadata: Metadata = { title: "Accept invitation", robots: { index: false } };

export default function InvitationPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <AcceptInvitation />
    </Suspense>
  );
}
