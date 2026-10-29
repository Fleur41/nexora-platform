"use client";

import { Check, ChevronsUpDown, Home, LayoutDashboard, LogOut, Receipt, Smartphone, Wrench, DoorOpen } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { NexoraMark } from "@/components/brand/logo";
import { AuthGate, FullPageSkeleton } from "@/components/layout/auth-gate";
import { NotificationBell } from "@/components/layout/notification-bell";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { useLogout } from "@/features/auth/api";
import { useMyOrganizations } from "@/features/organizations/api";
import { useTenancies } from "@/features/portal/api";
import { TenancyProvider, useTenancy } from "@/features/portal/tenancy";
import { errorMessage } from "@/lib/api/errors";
import { cn, initials } from "@/lib/utils";
import type { User } from "@/types/api";

import { InstallPrompt } from "./install-prompt";

export const PORTAL_NAV = [
  { href: "/portal", label: "Home", icon: Home },
  { href: "/portal/invoices", label: "Bills", icon: Receipt },
  { href: "/portal/pay", label: "Pay", icon: Smartphone },
  { href: "/portal/maintenance", label: "Repairs", icon: Wrench },
  { href: "/portal/move-out", label: "Move out", icon: DoorOpen },
] as const;

export function PortalShell({ children }: { children: React.ReactNode }) {
  return <AuthGate>{(user) => <TenancyGate user={user}>{children}</TenancyGate>}</AuthGate>;
}

function TenancyGate({ user, children }: { user: User; children: React.ReactNode }) {
  const tenancies = useTenancies();
  const orgs = useMyOrganizations();
  if (tenancies.isError) {
    return (
      <div className="mx-auto max-w-md p-6">
        <ErrorState message={errorMessage(tenancies.error)} onRetry={() => tenancies.refetch()} />
      </div>
    );
  }
  if (!tenancies.data) return <FullPageSkeleton />;
  if (tenancies.data.length === 0) {
    return (
      <div className="mx-auto max-w-md p-6 pt-16">
        <EmptyState
          icon={Home}
          title="No tenancy linked to this account"
          description={`Your landlord can invite ${user.email} to the tenant portal. Open the link in the invitation email to connect your home.`}
          action={orgs.data?.length ? <Button asChild><Link href="/dashboard">Go to the staff dashboard</Link></Button> : undefined}
        />
      </div>
    );
  }
  return (
    <TenancyProvider tenancies={tenancies.data}>
      <PortalLayout user={user} hasDashboard={Boolean(orgs.data?.length)}>{children}</PortalLayout>
    </TenancyProvider>
  );
}

function isActive(pathname: string, href: string) {
  return href === "/portal" ? pathname === "/portal" : pathname.startsWith(href);
}

function PortalLayout({ user, hasDashboard, children }: { user: User; hasDashboard: boolean; children: React.ReactNode }) {
  const pathname = usePathname();
  const { tenancy, timeZone } = useTenancy();
  return (
    <div className="flex min-h-screen flex-col bg-muted/40 print:bg-white">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur print:hidden" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
          <Link href="/portal" aria-label="Portal home"><NexoraMark className="size-7" /></Link>
          <TenancySwitcher />
          <div className="flex-1" />
          <NotificationBell timeZone={timeZone} />
          <PortalUserMenu user={user} hasDashboard={hasDashboard} />
        </div>
        <nav aria-label="Portal" className="mx-auto hidden max-w-3xl gap-1 px-4 pb-2 sm:flex">
          {PORTAL_NAV.map((item) => (
            <Link key={item.href} href={item.href}
              className={cn("rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground",
                isActive(pathname, item.href) && "bg-muted text-foreground")}>
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-28 pt-5 sm:pb-10" data-tenancy={tenancy.tenant}>
        <InstallPrompt />
        {children}
      </main>
      {/* Thumb-reachable tab bar on phones, like a native app. */}
      <nav aria-label="Portal tabs" className="fixed inset-x-0 bottom-0 z-30 border-t bg-background sm:hidden print:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <ul className="grid grid-cols-5">
          {PORTAL_NAV.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <li key={href}>
                <Link href={href} aria-current={active ? "page" : undefined}
                  className={cn("flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-muted-foreground", active && "text-primary")}>
                  <Icon className={cn("size-5", active && "text-accent-strong")} aria-hidden />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

function TenancySwitcher() {
  const { tenancy, tenancies, switchTenancy } = useTenancy();
  const name = <span className="truncate text-sm font-semibold">{tenancy.organization.name}</span>;
  if (tenancies.length < 2) return <div className="min-w-0">{name}</div>;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex min-w-0 items-center gap-1 rounded-md px-1 py-1 hover:bg-muted">
        {name}
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        <span className="sr-only">Switch landlord</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Your homes</DropdownMenuLabel>
        {tenancies.map((t) => (
          <DropdownMenuItem key={t.tenant} onSelect={() => switchTenancy(t.tenant)}>
            {t.tenant === tenancy.tenant ? <Check /> : <span className="size-4" />}
            {t.organization.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PortalUserMenu({ user, hasDashboard }: { user: User; hasDashboard: boolean }) {
  const logout = useLogout();
  const router = useRouter();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex size-9 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {initials(user.full_name) || "?"}
        <span className="sr-only">Open account menu</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>
          <span className="block text-sm font-medium text-foreground">{user.full_name}</span>
          <span className="block font-normal">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {hasDashboard && (
          <DropdownMenuItem asChild>
            <Link href="/dashboard"><LayoutDashboard /> Staff dashboard</Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onSelect={() => logout.mutate(undefined, {
            onSuccess: () => router.replace("/login"),
            onError: (err) => toast.error(errorMessage(err)),
          })}
        >
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
