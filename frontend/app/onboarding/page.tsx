import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { NexoraLogo } from "@/components/brand/logo";
import { Skeleton } from "@/components/ui/skeleton";
import { Onboarding } from "@/features/organizations/components/onboarding";

export const metadata: Metadata = { title: "Set up your organization" };

export default function OnboardingPage() {
  return (
    <div className="min-h-screen bg-muted/40">
      <header className="px-4 py-6 sm:px-8">
        <Link href="/" aria-label="Nexora home">
          <NexoraLogo />
        </Link>
      </header>
      <main className="mx-auto w-full max-w-lg px-4 pb-16 pt-4 sm:pt-10">
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <Onboarding />
        </Suspense>
      </main>
    </div>
  );
}
