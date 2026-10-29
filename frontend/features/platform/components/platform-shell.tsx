"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";

import { NexoraLogo } from "@/components/brand/logo";
import { AuthGate } from "@/components/layout/auth-gate";
import { UserMenu } from "@/components/layout/user-menu";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/platform", label: "Organizations" },
  { href: "/platform/invoices", label: "Invoices" },
  { href: "/platform/plans", label: "Plans" },
];

/** Nexora's own console: only for platform admins. */
export function PlatformShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <AuthGate>
      {(user) =>
        !user.is_platform_admin ? (
          <div className="mx-auto max-w-md p-6 pt-16">
            <Alert variant="error" title="This area is for Nexora staff.">
              <Link className="underline" href="/dashboard">Go to your dashboard</Link>
            </Alert>
          </div>
        ) : (
          <div className="min-h-screen bg-muted/40">
            <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
              <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4 sm:px-6">
                <Link href="/platform" className="flex items-center gap-2">
                  <NexoraLogo />
                  <span className="rounded bg-primary px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground">Platform</span>
                </Link>
                <nav aria-label="Platform" className="flex gap-1">
                  {NAV.map((n) => {
                    const active = n.href === "/platform" ? pathname === "/platform" || pathname.startsWith("/platform/organizations") : pathname.startsWith(n.href);
                    return (
                      <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined}
                        className={cn("rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground", active && "bg-muted text-foreground")}>
                        {n.label}
                      </Link>
                    );
                  })}
                </nav>
                <div className="flex-1" />
                <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">My dashboard</Link>
                <UserMenu user={user} />
              </div>
            </header>
            <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>
          </div>
        )
      }
    </AuthGate>
  );
}
