import type { Metadata } from "next";
import { Suspense } from "react";

import { FullPageSkeleton } from "@/components/layout/auth-gate";
import { DashboardShell } from "@/components/layout/dashboard-shell";

export const metadata: Metadata = { title: { default: "Dashboard", template: "%s · Nexora" } };

// The dashboard is fully client-rendered behind the session check; the Suspense boundary
// lets dynamic routes (e.g. /dashboard/leases/[id]) read the URL at runtime.
export default function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  return (
    <Suspense fallback={<FullPageSkeleton />}>
      <DashboardShell>{children}</DashboardShell>
    </Suspense>
  );
}
