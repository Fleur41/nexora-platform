import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, apiDownload } from "@/lib/api/client";
import type {
  MaintenanceCategory,
  PortalInvoice,
  PortalMaintenance,
  PortalMoveOut,
  PortalPayment,
  PortalSummary,
  PortalTenancy,
  Urgency,
} from "@/types/api";

// Portal endpoints are scoped to the signed-in tenant; they never send X-Organization-ID.
const opts = { scoped: false } as const;
const base = (tenantId: string) => `/portal/tenancies/${tenantId}`;
// The landlord and M-Pesa change a tenant's account, not the tenant: refetch whenever a screen
// opens or the app returns to the foreground, so a payment or reply shows up straight away.
const live = { staleTime: 0, refetchOnWindowFocus: true } as const;

export function useTenancies(enabled = true) {
  return useQuery({ queryKey: ["portal", "tenancies"], queryFn: () => api.get<PortalTenancy[]>("/portal/tenancies/", undefined, opts), enabled });
}

export function usePortalSummary(tenantId: string) {
  return useQuery({ ...live, queryKey: ["portal", tenantId, "summary"], queryFn: () => api.get<PortalSummary>(`${base(tenantId)}/`, undefined, opts) });
}

export function usePortalInvoices(tenantId: string) {
  return useQuery({ ...live, queryKey: ["portal", tenantId, "invoices"], queryFn: () => api.get<PortalInvoice[]>(`${base(tenantId)}/invoices/`, undefined, opts) });
}

export function usePortalInvoice(tenantId: string, id: string) {
  return useQuery({ ...live, queryKey: ["portal", tenantId, "invoices", id], queryFn: () => api.get<PortalInvoice>(`${base(tenantId)}/invoices/${id}/`, undefined, opts) });
}

export function usePortalPayments(tenantId: string) {
  return useQuery({ ...live, queryKey: ["portal", tenantId, "payments"], queryFn: () => api.get<PortalPayment[]>(`${base(tenantId)}/payments/`, undefined, opts) });
}

export interface PortalReceipt extends PortalPayment {
  tenant_name: string;
  lease_reference: string | null;
  property_name: string | null;
  unit_number: string | null;
  organization: { name: string; phone: string; email: string; address: string; currency: string };
}

export function usePortalReceipt(tenantId: string, id: string) {
  return useQuery({ ...live, queryKey: ["portal", tenantId, "payments", id], queryFn: () => api.get<PortalReceipt>(`${base(tenantId)}/payments/${id}/`, undefined, opts) });
}

export interface PortalStatement {
  balance: string;
  entries: { date: string; type: string; description: string; reference: string; amount: string; balance: string }[];
}

export function usePortalStatement(tenantId: string, leaseId: string, enabled = true) {
  return useQuery({
    ...live,
    queryKey: ["portal", tenantId, "statement", leaseId],
    queryFn: () => api.get<PortalStatement>(`${base(tenantId)}/leases/${leaseId}/statement/`, undefined, opts),
    enabled: enabled && Boolean(leaseId),
  });
}

export function usePortalMaintenanceList(tenantId: string) {
  return useQuery({ ...live, queryKey: ["portal", tenantId, "maintenance"], queryFn: () => api.get<PortalMaintenance[]>(`${base(tenantId)}/maintenance/`, undefined, opts) });
}

export function usePortalMaintenance(tenantId: string, id: string) {
  return useQuery({ ...live, queryKey: ["portal", tenantId, "maintenance", id], queryFn: () => api.get<PortalMaintenance>(`${base(tenantId)}/maintenance/${id}/`, undefined, opts) });
}

function useInvalidatePortal(tenantId: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["portal", tenantId] });
}

export function useReportIssue(tenantId: string) {
  const invalidate = useInvalidatePortal(tenantId);
  return useMutation({
    mutationFn: (input: { lease: string; category: MaintenanceCategory; title: string; description: string; urgency: Urgency }) =>
      api.post<PortalMaintenance>(`${base(tenantId)}/maintenance/`, input, opts),
    onSuccess: invalidate,
  });
}

export function useMaintenanceMessage(tenantId: string, id: string) {
  const invalidate = useInvalidatePortal(tenantId);
  return useMutation({
    mutationFn: (input: { action: "message"; body: string } | { action: "cancel" } | { action: "photo"; file: File }) => {
      if (input.action === "photo") {
        const form = new FormData();
        form.append("action", "photo");
        form.append("file", input.file);
        return api.upload<PortalMaintenance>(`${base(tenantId)}/maintenance/${id}/`, form, opts);
      }
      return api.post<PortalMaintenance>(`${base(tenantId)}/maintenance/${id}/`, input, opts);
    },
    onSuccess: invalidate,
  });
}

/** Attach photos to a request, one upload at a time (each is checked server-side). */
export function useAddRepairPhotos(tenantId: string) {
  const invalidate = useInvalidatePortal(tenantId);
  return useMutation({
    mutationFn: async ({ id, files }: { id: string; files: File[] }) => {
      for (const file of files) {
        const form = new FormData();
        form.append("action", "photo");
        form.append("file", file);
        await api.upload<PortalMaintenance>(`${base(tenantId)}/maintenance/${id}/`, form, opts);
      }
    },
    onSettled: invalidate,
  });
}

export function usePortalPhoto(tenantId: string, requestId: string, photoId: string) {
  return useQuery({
    queryKey: ["portal", tenantId, "photo", photoId],
    queryFn: () => apiDownload(`${base(tenantId)}/maintenance/${requestId}/photos/${photoId}/`, opts),
    staleTime: 5 * 60_000,
  });
}

export function usePortalMoveOuts(tenantId: string) {
  return useQuery({ ...live, queryKey: ["portal", tenantId, "move-out"], queryFn: () => api.get<PortalMoveOut[]>(`${base(tenantId)}/move-out/`, undefined, opts) });
}

export function useGivePortalNotice(tenantId: string) {
  const invalidate = useInvalidatePortal(tenantId);
  return useMutation({
    mutationFn: (input: { lease: string; intended_date: string; message: string }) =>
      api.post<PortalMoveOut>(`${base(tenantId)}/move-out/`, input, opts),
    onSuccess: invalidate,
  });
}

export function useWithdrawPortalNotice(tenantId: string) {
  const invalidate = useInvalidatePortal(tenantId);
  return useMutation({
    mutationFn: (id: string) => api.post<PortalMoveOut>(`${base(tenantId)}/move-out/${id}/withdraw/`, undefined, opts),
    onSuccess: invalidate,
  });
}

export function usePortalPay(tenantId: string) {
  return useMutation({
    mutationFn: (input: { lease: string; amount: string; phone: string }) =>
      api.post<{ id: string; status: string }>(`${base(tenantId)}/pay/`, input, opts),
  });
}

export function usePortalInvitePreview(token: string) {
  return useQuery({
    queryKey: ["portal", "invite", token],
    queryFn: () =>
      api.post<{ organization_name: string; tenant_name: string; email: string; expires_at: string; is_usable: boolean }>(
        "/portal/invitations/preview/", { token }, opts),
    retry: false,
  });
}

export function useAcceptPortalInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => api.post<{ tenant: string; organization_name: string }>("/portal/invitations/accept/", { token }, opts),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portal"] }),
  });
}

export function useTenantPortalInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tenantId, action, email }: { tenantId: string; action: "portal-invite" | "portal-revoke"; email?: string }) =>
      api.post(`/tenants/${tenantId}/${action}/`, email ? { email } : {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["org"] }),
  });
}
