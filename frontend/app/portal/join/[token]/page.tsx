import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { NexoraLogo } from "@/components/brand/logo";
import { Skeleton } from "@/components/ui/skeleton";
import { PortalJoin } from "@/features/portal/components/portal-join";

export const metadata: Metadata = { title: "Join your home", robots: { index: false } };

export default function PortalJoinPage() {
  return (
    <div className="flex min-h-screen flex-col bg-muted/40">
      <header className="px-4 py-6 sm:px-8">
        <Link href="/" aria-label="Nexora home"><NexoraLogo /></Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-4 sm:pt-12">
        <div className="w-full max-w-md">
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <PortalJoin />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
