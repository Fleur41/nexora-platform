import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api/client";
import { useInvalidateOrg, useOrgKey } from "@/lib/org-query";
import type { MoveOutNotice, Paginated, SettlementPreview } from "@/types/api";

export function useMoveOuts(params: { open?: boolean; lease?: string; page?: number }, enabled = true) {
  const key = useOrgKey();
  return useQuery({
    queryKey: key("move-outs", params),
    queryFn: () => api.get<Paginated<MoveOutNotice>>("/move-outs/", params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useMoveOut(id: string) {
  const key = useOrgKey();
  return useQuery({ queryKey: key("move-outs", "detail", id), queryFn: () => api.get<MoveOutNotice>(`/move-outs/${id}/`) });
}

export function useSettlementPreview(id: string, params: { moved_out_on: string; apply_deposit_to_balance: boolean; damages?: string }, enabled = true) {
  const key = useOrgKey();
  return useQuery({
    queryKey: key("move-outs", "settlement", id, params),
    queryFn: () => api.get<SettlementPreview>(`/move-outs/${id}/settlement/`, params),
    enabled,
  });
}

export function useGiveNotice() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: (input: { lease: string; intended_date: string; message: string }) => api.post<MoveOutNotice>("/move-outs/", input),
    onSuccess: () => invalidate("move-outs", "units", "leases"),
  });
}

export function useMoveOutAction() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: ({ id, action, body }: { id: string; action: "acknowledge" | "withdraw" | "schedule-inspection" | "complete"; body?: object }) =>
      api.post<MoveOutNotice>(`/move-outs/${id}/${action}/`, body ?? {}),
    onSuccess: () => invalidate("move-outs", "units", "leases", "inspections", "deposits", "accounts", "invoices", "payments", "properties"),
  });
}
