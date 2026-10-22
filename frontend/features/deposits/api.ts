import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api/client";
import { useInvalidateOrg, useOrgKey } from "@/lib/org-query";
import type { DepositDetail, DepositSummary, DepositTransaction, Paginated, PaymentMethod } from "@/types/api";

export function useDeposit(leaseId: string, enabled = true) {
  const key = useOrgKey();
  return useQuery({
    queryKey: key("deposits", leaseId),
    queryFn: () => api.get<DepositDetail>(`/deposits/${leaseId}/`),
    enabled,
  });
}

export function useDeposits(params: { search?: string; page?: number }, enabled = true) {
  const key = useOrgKey();
  return useQuery({
    queryKey: key("deposits", "list", params),
    queryFn: () => api.get<Paginated<DepositSummary>>("/deposits/", params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useDepositTotals(enabled = true) {
  const key = useOrgKey();
  return useQuery({
    queryKey: key("deposits", "summary"),
    queryFn: () => api.get<{ currency: string; held: string; outstanding: string }>("/deposits/summary/"),
    enabled,
  });
}

export interface DepositInput {
  kind: "received" | "deduction" | "refund";
  amount: string;
  transaction_date: string;
  method: PaymentMethod;
  reference: string;
  reason: string;
}

export function useRecordDeposit(leaseId: string) {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: (input: DepositInput) => api.post<DepositTransaction>(`/deposits/${leaseId}/transactions/`, input),
    onSuccess: () => invalidate("deposits"),
  });
}

export function useReverseDeposit(leaseId: string) {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post<DepositTransaction>(`/deposits/${leaseId}/transactions/${id}/reverse/`, { reason }),
    onSuccess: () => invalidate("deposits"),
  });
}
