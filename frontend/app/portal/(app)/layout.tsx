import { Suspense } from "react";

import { FullPageSkeleton } from "@/components/layout/auth-gate";
import { PortalShell } from "@/features/portal/components/portal-shell";

// Client-rendered behind the session check, like the dashboard.
export default function PortalAppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<FullPageSkeleton />}>
      <PortalShell>{children}</PortalShell>
    </Suspense>
  );
}
