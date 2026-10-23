import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api/client";
import { useInvalidateOrg, useOrgKey } from "@/lib/org-query";
import type { Inspection, InspectionDetail, InspectionKind, Paginated } from "@/types/api";

export function useInspections(params: { status?: string; kind?: string; page?: number; lease?: string }, enabled = true) {
  const key = useOrgKey();
  return useQuery({
    queryKey: key("inspections", params),
    queryFn: () => api.get<Paginated<Inspection>>("/inspections/", params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useInspection(id: string) {
  const key = useOrgKey();
  return useQuery({ queryKey: key("inspections", "detail", id), queryFn: () => api.get<InspectionDetail>(`/inspections/${id}/`) });
}

export function useScheduleInspection() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: (input: { unit: string; kind: InspectionKind; scheduled_for: string; inspector?: string | null }) =>
      api.post<InspectionDetail>("/inspections/", input),
    onSuccess: () => invalidate("inspections"),
  });
}

export function useSaveInspectionItems() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: ({ id, items }: { id: string; items: object[] }) => api.patch<InspectionDetail>(`/inspections/${id}/items/`, { items }),
    onSuccess: () => invalidate("inspections", "move-outs"),
  });
}

export function useInspectionAction() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: ({ id, action, body }: { id: string; action: "complete" | "cancel"; body?: object }) =>
      api.post<InspectionDetail>(`/inspections/${id}/${action}/`, body ?? {}),
    onSuccess: () => invalidate("inspections", "move-outs"),
  });
}
