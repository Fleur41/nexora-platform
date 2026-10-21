import type { Metadata } from "next";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { TeamPage } from "@/features/team/components/team-page";

export const metadata: Metadata = { title: "Team" };

export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <TeamPage />
    </Suspense>
  );
}
