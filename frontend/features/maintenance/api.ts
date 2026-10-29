import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api/client";
import { useInvalidateOrg, useOrgKey } from "@/lib/org-query";
import type { MaintenanceCategory, MaintenanceDetail, MaintenanceRequest, MaintenanceStatus, Paginated, Urgency } from "@/types/api";

export type MaintenanceParams = {
  search?: string;
  status?: MaintenanceStatus | "";
  urgency?: Urgency | "";
  open?: boolean;
  mine?: boolean;
  property?: string;
  unit?: string;
  tenant?: string;
  page?: number;
};

export function useMaintenanceList(params: MaintenanceParams, enabled = true) {
  const key = useOrgKey();
  return useQuery({
    queryKey: key("maintenance", params),
    queryFn: () => api.get<Paginated<MaintenanceRequest>>("/maintenance/", params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useMaintenance(id: string) {
  const key = useOrgKey();
  return useQuery({ queryKey: key("maintenance", "detail", id), queryFn: () => api.get<MaintenanceDetail>(`/maintenance/${id}/`) });
}

export function useCreateMaintenance() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: (input: { unit: string; category: MaintenanceCategory; title: string; description: string; urgency: Urgency }) =>
      api.post<MaintenanceDetail>("/maintenance/", input),
    onSuccess: () => invalidate("maintenance"),
  });
}

export function useMaintenanceAction() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: ({ id, path, body }: { id: string; path: string; body: object }) =>
      api.post<MaintenanceDetail>(`/maintenance/${id}/${path}/`, body),
    onSuccess: () => invalidate("maintenance", "audit-logs"),
  });
}
