import type { Metadata } from "next";
import { Suspense } from "react";

import { FullPageSkeleton } from "@/components/layout/auth-gate";
import { PlatformShell } from "@/features/platform/components/platform-shell";

export const metadata: Metadata = { title: { default: "Platform", template: "%s · Nexora platform" }, robots: { index: false } };

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<FullPageSkeleton />}>
      <PlatformShell>{children}</PlatformShell>
    </Suspense>
  );
}
