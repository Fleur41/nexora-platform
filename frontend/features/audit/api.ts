import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { useOrganization } from "@/components/providers/organization-provider";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";
import type { AuditLogEntry, Paginated } from "@/types/api";

export type AuditLogParams = {
  search?: string;
  page?: number;
  page_size?: number;
  /** Comma-separated actions to leave out. */
  exclude_action?: string;
};

export function useAuditLogs(params: AuditLogParams, enabled = true) {
  const { organizationId } = useOrganization();
  return useQuery({
    queryKey: queryKeys.auditLogs(organizationId, params),
    queryFn: () => api.get<Paginated<AuditLogEntry>>("/audit-logs/", params),
    placeholderData: keepPreviousData,
    // Every mutation can add audit entries, so always refetch when the log is shown.
    staleTime: 0,
    refetchOnMount: "always",
    enabled,
  });
}
