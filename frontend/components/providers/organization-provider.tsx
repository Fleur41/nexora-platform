"use client";

import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { setActiveOrganizationId } from "@/lib/api/organization-store";
import type { MyOrganization } from "@/types/api";

interface OrganizationContextValue {
  organizationId: string;
  current: MyOrganization;
  organizations: MyOrganization[];
  /** UX hint only: the backend enforces every capability independently. */
  can: (capability: string) => boolean;
  switchOrganization: (id: string) => void;
}

const OrganizationContext = React.createContext<OrganizationContextValue | null>(null);

export function OrganizationProvider({
  organizations,
  activeId,
  onSwitch,
  children,
}: {
  organizations: MyOrganization[];
  activeId: string;
  onSwitch: (id: string) => void;
  children: React.ReactNode;
}) {
  const qc = useQueryClient();
  const current = organizations.find((o) => o.organization.id === activeId) ?? organizations[0]!;

  const value = React.useMemo<OrganizationContextValue>(() => {
    const caps = new Set(current.capabilities);
    return {
      organizationId: current.organization.id,
      current,
      organizations,
      can: (capability) => caps.has(capability),
      switchOrganization: (id) => {
        if (id === current.organization.id) return;
        setActiveOrganizationId(id);
        // Drop every organization-scoped cache entry so nothing leaks across switches.
        qc.removeQueries({ queryKey: ["org"] });
        onSwitch(id);
      },
    };
  }, [current, organizations, qc, onSwitch]);

  return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>;
}

export function useOrganization(): OrganizationContextValue {
  const ctx = React.useContext(OrganizationContext);
  if (!ctx) throw new Error("useOrganization must be used inside the dashboard");
  return ctx;
}
