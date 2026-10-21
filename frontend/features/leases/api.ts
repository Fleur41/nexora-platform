import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api/client";
import { useInvalidateOrg, useOrgKey } from "@/lib/org-query";
import type { BillingFrequency, Lease, LeaseStatus, Paginated, RentTerm, UnitStatus } from "@/types/api";

// Lease changes move units between statuses and change tenant lease counts.
const LEASE_RESOURCES = ["leases", "units", "properties", "tenants"];

export type LeaseListParams = {
  status?: LeaseStatus | "";
  property?: string;
  tenant?: string;
  unit?: string;
  search?: string;
  expiring_within_days?: number;
  page?: number;
  page_size?: number;
  ordering?: string;
};

export function useLeases(params: LeaseListParams, enabled = true) {
  const key = useOrgKey();
  return useQuery({
    queryKey: key("leases", params),
    queryFn: () => api.get<Paginated<Lease>>("/leases/", params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useLease(id: string) {
  const key = useOrgKey();
  return useQuery({
    queryKey: key("leases", "detail", id),
    queryFn: () => api.get<Lease>(`/leases/${id}/`),
  });
}

export interface LeaseInput {
  tenant: string;
  unit: string;
  start_date: string;
  end_date: string | null;
  monthly_rent: string;
  deposit_amount: string;
  billing_frequency: BillingFrequency;
  rent_due_day: number;
  notes: string;
  activate?: boolean;
}

export function useCreateLease() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: (input: LeaseInput) => api.post<Lease>("/leases/", input),
    onSuccess: () => invalidate(...LEASE_RESOURCES),
  });
}

export function useUpdateDraftLease() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: ({ id, ...input }: Partial<LeaseInput> & { id: string }) =>
      api.patch<Lease>(`/leases/${id}/`, input),
    onSuccess: () => invalidate(...LEASE_RESOURCES),
  });
}

export function useLeaseAction() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: ({
      id,
      action,
      body,
    }: {
      id: string;
      action: "activate" | "cancel" | "end";
      body?: { ended_on?: string; unit_status?: UnitStatus; reason?: string };
    }) => api.post<Lease>(`/leases/${id}/${action}/`, body ?? {}),
    onSuccess: () => invalidate(...LEASE_RESOURCES),
  });
}

export function useAddRentTerm() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: ({
      leaseId,
      ...input
    }: {
      leaseId: string;
      effective_from: string;
      monthly_rent: string;
      note?: string;
    }) => api.post<RentTerm>(`/leases/${leaseId}/rent-terms/`, input),
    onSuccess: () => invalidate("leases"),
  });
}

export function useRemoveRentTerm() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: ({ leaseId, termId }: { leaseId: string; termId: string }) =>
      api.delete(`/leases/${leaseId}/rent-terms/${termId}/`),
    onSuccess: () => invalidate("leases"),
  });
}
