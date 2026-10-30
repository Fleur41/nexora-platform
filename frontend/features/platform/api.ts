import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api/client";
import type { Plan, PlatformOrganization, PlatformOrganizationDetail, PlatformOverview, SubscriptionInvoice } from "@/types/api";

// The platform console isn't tied to an organization: requests never send the org header.
const open = { scoped: false } as const;
const KEY = ["platform"] as const;

export function usePlatformOverview() {
  return useQuery({ queryKey: [...KEY, "overview"], queryFn: () => api.get<PlatformOverview>("/platform/overview/", undefined, open) });
}

export function usePlatformOrganizations(params: { search?: string; subscription_status?: string }) {
  return useQuery({
    queryKey: [...KEY, "organizations", params],
    queryFn: () => api.get<PlatformOrganization[]>("/platform/organizations/", params, open),
  });
}

export function usePlatformOrganization(id: string) {
  return useQuery({
    queryKey: [...KEY, "organizations", id],
    queryFn: () => api.get<PlatformOrganizationDetail>(`/platform/organizations/${id}/`, undefined, open),
  });
}

function usePlatformMutation<T, V>(fn: (v: V) => Promise<T>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: KEY }) });
}

export type SubscriptionChange = { plan?: string; trial_ends_on?: string | null; paid_until?: string | null; complimentary?: boolean; notes?: string };

export function useUpdatePlatformSubscription(orgId: string) {
  return usePlatformMutation((body: SubscriptionChange) => api.post<PlatformOrganizationDetail>(`/platform/organizations/${orgId}/subscription/`, body, open));
}

export function useOrganizationStatus(orgId: string) {
  return usePlatformMutation(({ action, reason }: { action: "suspend" | "reactivate"; reason?: string }) =>
    api.post<PlatformOrganizationDetail>(`/platform/organizations/${orgId}/${action}/`, reason ? { reason } : {}, open));
}

export function useIssueInvoice(orgId: string) {
  return usePlatformMutation(() => api.post<SubscriptionInvoice>(`/platform/organizations/${orgId}/invoices/`, undefined, open));
}

export function useInvoiceAction() {
  return usePlatformMutation(({ id, action, body }: { id: string; action: "record-payment" | "void"; body: object }) =>
    api.post<SubscriptionInvoice>(`/platform/invoices/${id}/${action}/`, body, open));
}

export function usePlatformInvoices(status: string) {
  return useQuery({
    queryKey: [...KEY, "invoices", status],
    queryFn: () => api.get<(SubscriptionInvoice & { organization: { id: string; name: string } })[]>("/platform/invoices/", status ? { status } : undefined, open),
  });
}

export function usePlatformPlans() {
  return useQuery({ queryKey: [...KEY, "plans"], queryFn: () => api.get<(Plan & { organizations: number })[]>("/platform/plans/", undefined, open) });
}

export function useSavePlan() {
  return usePlatformMutation(({ id, ...body }: Partial<Plan> & { id?: string }) =>
    id ? api.patch<Plan>(`/platform/plans/${id}/`, body, open) : api.post<Plan>("/platform/plans/", body, open));
}

export function useStartSupport(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { reason: string; minutes: number }) =>
      api.post<{ id: string; organization: string; expires_at: string }>(`/platform/organizations/${orgId}/support/`, body, open),
    // The dashboard lists support access next to real memberships.
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: KEY }), qc.invalidateQueries({ queryKey: ["organizations"] })]),
  });
}

export function useEndSupport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/platform/support/${id}/end/`, undefined, open),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: KEY }), qc.invalidateQueries({ queryKey: ["organizations"] })]),
  });
}
