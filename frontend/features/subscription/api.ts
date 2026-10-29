import { useMutation, useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api/client";
import { useInvalidateOrg, useOrgKey } from "@/lib/org-query";
import type { SubscriptionInvoice, SubscriptionSummary } from "@/types/api";

export function useSubscription(enabled = true) {
  const key = useOrgKey();
  return useQuery({
    queryKey: key("subscription"),
    queryFn: () => api.get<SubscriptionSummary>("/subscription/"),
    staleTime: 5 * 60_000,
    enabled,
  });
}

export function useSubscriptionInvoices(enabled = true) {
  const key = useOrgKey();
  return useQuery({
    queryKey: key("subscription", "invoices"),
    queryFn: () => api.get<SubscriptionInvoice[]>("/subscription/invoices/"),
    enabled,
  });
}

export function useChangePlan() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: (plan: string) => api.post("/subscription/change-plan/", { plan }),
    onSuccess: () => invalidate("subscription"),
  });
}

export function usePayNexoraInvoice() {
  return useMutation({
    mutationFn: ({ id, phone }: { id: string; phone: string }) =>
      api.post<{ id: string; status: string }>(`/subscription/invoices/${id}/pay/`, { phone }),
  });
}
