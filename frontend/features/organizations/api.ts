import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";
import type { InvitationPreview, MyOrganization, Organization } from "@/types/api";

export type OrganizationInput = Partial<
  Pick<
    Organization,
    "name" | "legal_name" | "email" | "phone" | "address" | "country" | "currency" | "timezone"
  >
>;

export function useMyOrganizations(enabled = true) {
  return useQuery({
    queryKey: queryKeys.myOrganizations,
    queryFn: () => api.get<MyOrganization[]>("/organizations/", undefined, { scoped: false }),
    enabled,
  });
}

export function useCreateOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: OrganizationInput & { name: string }) =>
      api.post<MyOrganization>("/organizations/", input, { scoped: false }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.myOrganizations }),
  });
}

export function useUpdateOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: OrganizationInput) =>
      api.patch<Organization>("/organizations/current/", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.myOrganizations }),
  });
}

export function useInvitationPreview(token: string) {
  return useQuery({
    queryKey: queryKeys.invitationPreview(token),
    queryFn: () =>
      api.post<InvitationPreview>(
        "/invitations/preview/",
        { token },
        { scoped: false },
      ),
    retry: false,
  });
}

export function useAcceptInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) =>
      api.post<MyOrganization>("/invitations/accept/", { token }, { scoped: false }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.myOrganizations }),
  });
}
