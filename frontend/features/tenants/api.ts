import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api/client";
import { useInvalidateOrg, useOrgKey } from "@/lib/org-query";
import type { Paginated, Tenant } from "@/types/api";

export type TenantListParams = {
  search?: string;
  status?: "active" | "archived";
  page?: number;
  page_size?: number;
};

export function useTenants(params: TenantListParams, enabled = true) {
  const key = useOrgKey();
  return useQuery({
    queryKey: key("tenants", params),
    queryFn: () => api.get<Paginated<Tenant>>("/tenants/", params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useTenant(id: string) {
  const key = useOrgKey();
  return useQuery({
    queryKey: key("tenants", "detail", id),
    queryFn: () => api.get<Tenant>(`/tenants/${id}/`),
  });
}

export type TenantInput = Partial<
  Omit<Tenant, "id" | "status" | "active_lease_count" | "created_at" | "updated_at">
>;

export function useSaveTenant() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: ({ id, ...input }: TenantInput & { id?: string }) =>
      id ? api.patch<Tenant>(`/tenants/${id}/`, input) : api.post<Tenant>("/tenants/", input),
    onSuccess: () => invalidate("tenants"),
  });
}

export function useTenantStatus() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: "archive" | "restore" }) =>
      api.post<Tenant>(`/tenants/${id}/${action}/`),
    onSuccess: () => invalidate("tenants"),
  });
}
