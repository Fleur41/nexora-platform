import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api/client";
import { useInvalidateOrg, useOrgKey } from "@/lib/org-query";
import type {
  BillingPreview,
  BillingRun,
  BillingSettings,
  BillingSummary,
  ChargeRule,
  ChargeType,
  Invoice,
  InvoiceDetail,
  LeaseAccount,
  Paginated,
  ResolvedCharges,
  SharedCost,
  TenantAccount,
} from "@/types/api";

// Billing changes ripple into balances, statements and the audit log.
const BILLING_RESOURCES = ["invoices", "billing-runs", "billing", "accounts", "shared-costs", "meter-readings"];

export function useChargeTypes() {
  const key = useOrgKey();
  return useQuery({
    queryKey: key("charge-types"),
    queryFn: () => api.get<ChargeType[]>("/charge-types/"),
    staleTime: 5 * 60_000,
  });
}

export function useSaveChargeType() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: ({ id, ...input }: Partial<ChargeType> & { id?: string }) =>
      id ? api.patch<ChargeType>(`/charge-types/${id}/`, input) : api.post<ChargeType>("/charge-types/", input),
    onSuccess: () => invalidate("charge-types", "charge-rules"),
  });
}

export type RuleListParams = { charge_type?: string; scope?: string; page?: number; page_size?: number };

export function useChargeRules(params: RuleListParams, enabled = true) {
  const key = useOrgKey();
  return useQuery({
    queryKey: key("charge-rules", params),
    queryFn: () => api.get<Paginated<ChargeRule>>("/charge-rules/", params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export type RuleInput = Partial<
  Pick<
    ChargeRule,
    | "charge_type"
    | "scope"
    | "property"
    | "unit_type"
    | "unit"
    | "method"
    | "amount"
    | "usage_unit"
    | "is_enabled"
    | "included_in_rent"
    | "effective_from"
    | "effective_to"
    | "description"
  >
>;

export function useSaveChargeRule() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: ({ id, ...input }: RuleInput & { id?: string }) =>
      id ? api.patch<ChargeRule>(`/charge-rules/${id}/`, input) : api.post<ChargeRule>("/charge-rules/", input),
    onSuccess: () => invalidate("charge-rules"),
  });
}

export function useEndChargeRule() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: ({ id, effective_to }: { id: string; effective_to: string }) =>
      api.post<ChargeRule>(`/charge-rules/${id}/end/`, { effective_to }),
    onSuccess: () => invalidate("charge-rules"),
  });
}

export function useDeleteChargeRule() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/charge-rules/${id}/`),
    onSuccess: () => invalidate("charge-rules"),
  });
}

export function useResolvedCharges(unitId: string | undefined, enabled = true) {
  const key = useOrgKey();
  return useQuery({
    queryKey: key("charge-rules", "resolve", unitId),
    queryFn: () => api.get<ResolvedCharges>("/charge-rules/resolve/", { unit: unitId }),
    enabled: enabled && Boolean(unitId),
  });
}

export function useBillingSettings(enabled = true) {
  const key = useOrgKey();
  return useQuery({
    queryKey: key("billing", "settings"),
    queryFn: () => api.get<BillingSettings>("/billing/settings/"),
    enabled,
  });
}

export function useSaveBillingSettings() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: (input: Partial<BillingSettings>) => api.patch<BillingSettings>("/billing/settings/", input),
    onSuccess: () => invalidate("billing"),
  });
}

export function useBillingSummary(enabled = true) {
  const key = useOrgKey();
  return useQuery({
    queryKey: key("billing", "summary"),
    queryFn: () => api.get<BillingSummary>("/billing/summary/"),
    enabled,
  });
}

export function usePreviewBilling() {
  return useMutation({
    mutationFn: (period: string) => api.post<BillingPreview>("/billing-runs/preview/", { period }),
  });
}

export function useRunBilling() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: (period: string) => api.post<BillingRun>("/billing-runs/", { period }),
    onSuccess: () => invalidate(...BILLING_RESOURCES),
  });
}

export function useBillingRuns(page = 1, enabled = true) {
  const key = useOrgKey();
  return useQuery({
    queryKey: key("billing-runs", page),
    queryFn: () => api.get<Paginated<BillingRun>>("/billing-runs/", { page }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export type InvoiceListParams = {
  search?: string;
  status?: "issued" | "void" | "";
  outstanding?: boolean;
  overdue?: boolean;
  lease?: string;
  tenant?: string;
  property?: string;
  page?: number;
  page_size?: number;
};

export function useInvoices(params: InvoiceListParams, enabled = true) {
  const key = useOrgKey();
  return useQuery({
    queryKey: key("invoices", params),
    queryFn: () => api.get<Paginated<Invoice>>("/invoices/", params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useInvoice(id: string) {
  const key = useOrgKey();
  return useQuery({
    queryKey: key("invoices", "detail", id),
    queryFn: () => api.get<InvoiceDetail>(`/invoices/${id}/`),
  });
}

export function useInvoiceAction() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: ({ id, action, body }: { id: string; action: "void" | "credit"; body: { reason: string; amount?: string } }) =>
      api.post<InvoiceDetail>(`/invoices/${id}/${action}/`, body),
    onSuccess: () => invalidate(...BILLING_RESOURCES),
  });
}

export interface OneOffInput {
  lease: string;
  due_date: string | null;
  notes: string;
  lines: { charge_type: string; description: string; amount: string }[];
}

export function useCreateOneOffInvoice() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: (input: OneOffInput) => api.post<InvoiceDetail>("/invoices/", input),
    onSuccess: () => invalidate(...BILLING_RESOURCES),
  });
}

export function useSharedCosts(page = 1, enabled = true) {
  const key = useOrgKey();
  return useQuery({
    queryKey: key("shared-costs", page),
    queryFn: () => api.get<Paginated<SharedCost>>("/shared-costs/", { page }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useCreateSharedCost() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: (input: { property: string; charge_type: string; period: string; total_amount: string; description: string }) =>
      api.post<SharedCost>("/shared-costs/", input),
    onSuccess: () => invalidate("shared-costs"),
  });
}

export function useDeleteSharedCost() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/shared-costs/${id}/`),
    onSuccess: () => invalidate("shared-costs"),
  });
}

export function useLeaseAccount(leaseId: string, enabled = true) {
  const key = useOrgKey();
  return useQuery({
    queryKey: key("accounts", "lease", leaseId),
    queryFn: () => api.get<LeaseAccount>(`/leases/${leaseId}/account/`),
    enabled,
  });
}

export function useTenantAccount(tenantId: string, enabled = true) {
  const key = useOrgKey();
  return useQuery({
    queryKey: key("accounts", "tenant", tenantId),
    queryFn: () => api.get<TenantAccount>(`/tenants/${tenantId}/account/`),
    enabled,
  });
}
