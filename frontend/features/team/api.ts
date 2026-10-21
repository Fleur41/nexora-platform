import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useOrganization } from "@/components/providers/organization-provider";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";
import type { CapabilityCatalog, Invitation, Membership, Paginated, Role } from "@/types/api";

export type MemberListParams = {
  search?: string;
  role?: Role | "";
  page?: number;
};

export function useMembers(params: MemberListParams, enabled = true) {
  const { organizationId } = useOrganization();
  return useQuery({
    queryKey: queryKeys.members(organizationId, params),
    queryFn: () =>
      api.get<Paginated<Membership>>("/members/", { ...params, ordering: "user__full_name" }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useInvitations(params: { status?: string; page?: number }, enabled = true) {
  const { organizationId } = useOrganization();
  return useQuery({
    queryKey: queryKeys.invitations(organizationId, params),
    queryFn: () => api.get<Paginated<Invitation>>("/invitations/", params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useCapabilityCatalog() {
  return useQuery({
    queryKey: queryKeys.capabilityCatalog,
    queryFn: () => api.get<CapabilityCatalog>("/permissions/catalog/", undefined, { scoped: false }),
    staleTime: Infinity,
  });
}

function useInvalidateTeam() {
  const qc = useQueryClient();
  const { organizationId } = useOrganization();
  return () => qc.invalidateQueries({ queryKey: ["org", organizationId] });
}

export function useInviteMember() {
  const invalidate = useInvalidateTeam();
  return useMutation({
    mutationFn: (input: { email: string; role: Role }) =>
      api.post<Invitation>("/invitations/", input),
    onSuccess: invalidate,
  });
}

export function useInvitationAction() {
  const invalidate = useInvalidateTeam();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: "resend" | "revoke" }) =>
      api.post<Invitation>(`/invitations/${id}/${action}/`),
    onSuccess: invalidate,
  });
}

export interface MemberUpdate {
  role?: Role;
  extra_permissions?: string[];
  revoked_permissions?: string[];
}

export function useUpdateMember() {
  const invalidate = useInvalidateTeam();
  return useMutation({
    mutationFn: ({ id, ...input }: MemberUpdate & { id: string }) =>
      api.patch<Membership>(`/members/${id}/`, input),
    onSuccess: invalidate,
  });
}

export function useRemoveMember() {
  const invalidate = useInvalidateTeam();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/members/${id}/`),
    onSuccess: invalidate,
  });
}
