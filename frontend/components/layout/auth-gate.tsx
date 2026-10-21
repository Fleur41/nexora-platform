"use client";

import { usePathname, useRouter } from "next/navigation";
import * as React from "react";

import { useMe } from "@/features/auth/api";
import { ErrorState } from "@/components/ui/states";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api/errors";
import type { User } from "@/types/api";

/** Renders children only for signed-in users; otherwise sends them to /login. */
export function AuthGate({ children }: { children: (user: User) => React.ReactNode }) {
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();

  React.useEffect(() => {
    if (me.isSuccess && me.data === null) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [me.isSuccess, me.data, pathname, router]);

  if (me.isError) {
    return (
      <div className="mx-auto max-w-md p-6">
        <ErrorState message={errorMessage(me.error)} onRetry={() => me.refetch()} />
      </div>
    );
  }
  if (!me.data) return <FullPageSkeleton />;
  return <>{children(me.data)}</>;
}

export function FullPageSkeleton() {
  return (
    <div className="flex min-h-screen" aria-busy="true" aria-label="Loading">
      <div className="hidden w-64 bg-sidebar lg:block" />
      <div className="flex-1 space-y-4 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  );
}
