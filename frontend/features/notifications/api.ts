import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api/client";
import { useInvalidateOrg, useOrgKey } from "@/lib/org-query";
import type { Announcement, DeliveryLogEntry, InboxNotification, NotificationSettings, Paginated } from "@/types/api";

// The inbox belongs to the user (not an organization), so it never sends the org header.
const INBOX = ["inbox"] as const;

export function useInbox(enabled = true) {
  return useQuery({
    queryKey: [...INBOX, "list"],
    queryFn: () => api.get<Paginated<InboxNotification>>("/notifications/", { page_size: 20 }, { scoped: false }),
    enabled,
  });
}

export function useUnreadCount(enabled = true) {
  return useQuery({
    queryKey: [...INBOX, "count"],
    queryFn: () => api.get<{ count: number }>("/notifications/unread-count/", undefined, { scoped: false }),
    refetchInterval: 60_000,
    enabled,
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string | "all") =>
      id === "all"
        ? api.post<void>("/notifications/read-all/", undefined, { scoped: false })
        : api.post<void>(`/notifications/${id}/read/`, undefined, { scoped: false }),
    onSuccess: () => qc.invalidateQueries({ queryKey: INBOX }),
  });
}

export function useNotificationSettings(enabled = true) {
  const key = useOrgKey();
  return useQuery({ queryKey: key("notification-settings"), queryFn: () => api.get<NotificationSettings>("/notification-settings/"), enabled });
}

export function useSaveNotificationSettings() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: (input: Partial<NotificationSettings>) => api.patch<NotificationSettings>("/notification-settings/", input),
    onSuccess: () => invalidate("notification-settings"),
  });
}

export function useAnnouncements(page = 1, enabled = true) {
  const key = useOrgKey();
  return useQuery({
    queryKey: key("announcements", page),
    queryFn: () => api.get<Paginated<Announcement>>("/announcements/", { page }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useSendAnnouncement() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: (input: { title: string; body: string; property: string | null; send_email: boolean; send_sms: boolean }) =>
      api.post<Announcement>("/announcements/", input),
    onSuccess: () => invalidate("announcements", "notification-log"),
  });
}

export function useDeliveryLog(params: { page?: number; status?: string }, enabled = true) {
  const key = useOrgKey();
  return useQuery({
    queryKey: key("notification-log", params),
    queryFn: () => api.get<Paginated<DeliveryLogEntry>>("/notification-log/", params),
    placeholderData: keepPreviousData,
    enabled,
  });
}
