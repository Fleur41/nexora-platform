"use client";

import * as React from "react";

import type { PortalTenancy } from "@/types/api";

const STORAGE_KEY = "nexora.activeTenancyId";

interface TenancyContextValue {
  tenancy: PortalTenancy;
  tenantId: string;
  currency: string;
  timeZone: string;
  tenancies: PortalTenancy[];
  switchTenancy: (tenantId: string) => void;
}

const TenancyContext = React.createContext<TenancyContextValue | null>(null);

function stored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** A user can rent from more than one landlord; the portal shows one tenancy at a time. */
export function TenancyProvider({ tenancies, children }: { tenancies: PortalTenancy[]; children: React.ReactNode }) {
  const [chosen, setChosen] = React.useState<string | null>(null);
  const preferred = chosen ?? stored();
  const tenancy = tenancies.find((t) => t.tenant === preferred) ?? tenancies[0]!;
  const value = React.useMemo<TenancyContextValue>(
    () => ({
      tenancy,
      tenantId: tenancy.tenant,
      currency: tenancy.organization.currency,
      timeZone: tenancy.organization.timezone,
      tenancies,
      switchTenancy: (id) => {
        try {
          localStorage.setItem(STORAGE_KEY, id);
        } catch {
          // Private mode: the choice lasts for this visit only.
        }
        setChosen(id);
      },
    }),
    [tenancy, tenancies],
  );
  return <TenancyContext.Provider value={value}>{children}</TenancyContext.Provider>;
}

export function useTenancy(): TenancyContextValue {
  const value = React.useContext(TenancyContext);
  if (!value) throw new Error("useTenancy must be used inside the tenant portal");
  return value;
}
