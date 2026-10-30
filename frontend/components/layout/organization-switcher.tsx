"use client";

import { Check, ChevronsUpDown, Plus } from "lucide-react";
import Link from "next/link";

import { useOrganization } from "@/components/providers/organization-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ROLE_LABELS } from "@/lib/roles";

export function OrganizationSwitcher() {
  const { current, organizations, switchOrganization } = useOrganization();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-3 rounded-lg bg-white/5 px-3 py-2 text-left text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-sm font-semibold">
          {current.organization.name.charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{current.organization.name}</span>
          <span className="block truncate text-xs text-sidebar-foreground">
            {current.support_until ? "Nexora support (read-only)" : ROLE_LABELS[current.role]}
          </span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-sidebar-foreground" aria-hidden />
        <span className="sr-only">Switch organization</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        {organizations.map((o) => (
          <DropdownMenuItem
            key={o.organization.id}
            onSelect={() => switchOrganization(o.organization.id)}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate">{o.organization.name}</span>
              <span className="block text-xs text-muted-foreground">{o.support_until ? "Nexora support (read-only)" : ROLE_LABELS[o.role]}</span>
            </span>
            {o.organization.id === current.organization.id && <Check aria-label="Active" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/onboarding?new=1">
            <Plus /> Create organization
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
