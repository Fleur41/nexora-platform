"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";

import { NexoraLogo } from "@/components/brand/logo";
import { OrganizationProvider, useOrganization } from "@/components/providers/organization-provider";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";
import { useMyOrganizations } from "@/features/organizations/api";
import { errorMessage } from "@/lib/api/errors";
import { getActiveOrganizationId, setActiveOrganizationId } from "@/lib/api/organization-store";
import { DASHBOARD_NAV } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import type { User } from "@/types/api";

import { AuthGate, FullPageSkeleton } from "./auth-gate";
import { OrganizationSwitcher } from "./organization-switcher";
import { UserMenu } from "./user-menu";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return <AuthGate>{(user) => <OrganizationGate user={user}>{children}</OrganizationGate>}</AuthGate>;
}

function OrganizationGate({ user, children }: { user: User; children: React.ReactNode }) {
  const orgs = useMyOrganizations();
  const router = useRouter();
  const [chosenId, setChosenId] = React.useState<string | null>(null);

  // The stored id is only a preference; fall back to the first organization the user
  // actually belongs to if it is missing or no longer valid.
  const activeId = React.useMemo(() => {
    if (!orgs.data?.length) return null;
    const preferred = chosenId ?? getActiveOrganizationId();
    const valid = orgs.data.find((o) => o.organization.id === preferred);
    return (valid ?? orgs.data[0]!).organization.id;
  }, [orgs.data, chosenId]);

  React.useEffect(() => {
    if (orgs.data?.length === 0) router.replace("/onboarding");
  }, [orgs.data, router]);

  React.useEffect(() => {
    if (activeId) setActiveOrganizationId(activeId);
  }, [activeId]);

  const handleSwitch = React.useCallback(
    (id: string) => {
      setChosenId(id);
      router.push("/dashboard");
    },
    [router],
  );

  if (orgs.isError) {
    return (
      <div className="mx-auto max-w-md p-6">
        <ErrorState message={errorMessage(orgs.error)} onRetry={() => orgs.refetch()} />
      </div>
    );
  }
  if (!orgs.data || orgs.data.length === 0 || !activeId) return <FullPageSkeleton />;

  return (
    <OrganizationProvider organizations={orgs.data} activeId={activeId} onSwitch={handleSwitch}>
      {/* key forces a clean remount of all org-scoped state when switching */}
      <ShellLayout key={activeId} user={user}>
        {children}
      </ShellLayout>
    </OrganizationProvider>
  );
}

function ShellLayout({ user, children }: { user: User; children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = React.useState(false);

  return (
    <div className="flex min-h-screen bg-muted/40">
      <aside className="hidden w-64 shrink-0 flex-col bg-sidebar lg:flex">
        <SidebarContent />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside className="relative flex h-full w-72 max-w-[85%] flex-col bg-sidebar">
            <button
              className="absolute right-3 top-3 rounded p-1 text-sidebar-foreground hover:text-white"
              onClick={() => setMobileOpen(false)}
            >
              <X className="size-5" />
              <span className="sr-only">Close navigation</span>
            </button>
            <SidebarContent onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur sm:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
          >
            <Menu />
            <span className="sr-only">Open navigation</span>
          </Button>
          <div className="flex-1" />
          <UserMenu user={user} />
        </header>
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { can } = useOrganization();
  const items = DASHBOARD_NAV.filter((item) => !item.capability || can(item.capability));
  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <Link href="/dashboard" className="px-2 pt-2" onClick={onNavigate}>
        <NexoraLogo tone="inverse" />
      </Link>
      <OrganizationSwitcher />
      <nav aria-label="Main" className="flex flex-col gap-1">
        {items.map((item) => {
          const active =
            item.href === "/dashboard" ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-white/10 text-white"
                  : "text-sidebar-foreground hover:bg-white/5 hover:text-white",
              )}
            >
              <item.icon className="size-4" aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <p className="mt-auto px-2 text-xs text-sidebar-foreground/70">Nexora Platform · Phase 1</p>
    </div>
  );
}
