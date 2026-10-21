import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { setActiveOrganizationId } from "@/lib/api/organization-store";
import { queryKeys } from "@/lib/query-keys";
import type { User } from "@/types/api";

/** The signed-in user, or null when there is no session. */
export function useMe() {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: async () => {
      try {
        return await api.get<User>("/auth/me/", undefined, { scoped: false });
      } catch (err) {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return null;
        throw err;
      }
    },
    staleTime: 60_000,
  });
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface RegisterInput extends LoginInput {
  full_name: string;
  phone?: string;
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) => api.post<User>("/auth/login/", input, { scoped: false }),
    onSuccess: (user) => {
      qc.clear();
      qc.setQueryData(queryKeys.me, user);
    },
  });
}

export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterInput) =>
      api.post<User>("/auth/register/", input, { scoped: false }),
    onSuccess: (user) => {
      qc.clear();
      qc.setQueryData(queryKeys.me, user);
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<void>("/auth/logout/", undefined, { scoped: false }),
    onSettled: () => {
      setActiveOrganizationId(null);
      qc.clear();
      qc.setQueryData(queryKeys.me, null);
    },
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Pick<User, "full_name" | "phone">) =>
      api.patch<User>("/auth/me/", input, { scoped: false }),
    onSuccess: (user) => qc.setQueryData(queryKeys.me, user),
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (input: { current_password: string; new_password: string }) =>
      api.post<void>("/auth/password/change/", input, { scoped: false }),
  });
}

export function useRequestPasswordReset() {
  return useMutation({
    mutationFn: (input: { email: string }) =>
      api.post<{ detail: string }>("/auth/password/reset/", input, { scoped: false }),
  });
}

export function useConfirmPasswordReset() {
  return useMutation({
    mutationFn: (input: { uid: string; token: string; new_password: string }) =>
      api.post<void>("/auth/password/reset/confirm/", input, { scoped: false }),
  });
}
