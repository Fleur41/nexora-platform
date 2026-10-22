import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api/client";
import { useInvalidateOrg, useOrgKey } from "@/lib/org-query";
import type {
  Paginated,
  Payment,
  PaymentConfiguration,
  PaymentDetail,
  PaymentInstructions,
  PaymentMethodKind,
  PaymentRequest,
  PaymentsSummary,
  ProviderEvent,
  StatementImport,
} from "@/types/api";

// Payments move invoice balances, statements, credit and the overview numbers.
const MONEY_RESOURCES = ["payments", "invoices", "accounts", "billing", "payment-requests", "statement-imports"];

export type PaymentListParams = {
  search?: string;
  status?: string;
  matched?: boolean;
  lease?: string;
  method?: string;
  page?: number;
  page_size?: number;
};

export function usePayments(params: PaymentListParams, enabled = true) {
  const key = useOrgKey();
  return useQuery({
    queryKey: key("payments", params),
    queryFn: () => api.get<Paginated<Payment>>("/payments/", params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function usePayment(id: string) {
  const key = useOrgKey();
  return useQuery({ queryKey: key("payments", "detail", id), queryFn: () => api.get<PaymentDetail>(`/payments/${id}/`) });
}

export function usePaymentsSummary(enabled = true) {
  const key = useOrgKey();
  return useQuery({
    queryKey: key("payments", "summary"),
    queryFn: () => api.get<PaymentsSummary>("/payments/summary/"),
    enabled,
  });
}

export interface RecordPaymentInput {
  lease: string;
  amount: string;
  received_on: string;
  configuration?: string | null;
  method?: PaymentMethodKind;
  reference: string;
  payer_name: string;
  payer_phone: string;
  notes: string;
}

export function useRecordPayment() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: (input: RecordPaymentInput) => api.post<PaymentDetail>("/payments/", input),
    onSuccess: () => invalidate(...MONEY_RESOURCES),
  });
}

export function usePaymentAction() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: ({ id, action, body }: { id: string; action: "allocate" | "match" | "reverse" | "refund"; body: object }) =>
      api.post<PaymentDetail>(`/payments/${id}/${action}/`, body),
    onSuccess: () => invalidate(...MONEY_RESOURCES),
  });
}

export function usePaymentConfigurations(enabled = true) {
  const key = useOrgKey();
  return useQuery({
    queryKey: key("payment-configurations"),
    queryFn: () => api.get<PaymentConfiguration[]>("/payment-configurations/"),
    enabled,
  });
}

export type ConfigurationInput = Partial<
  Omit<
    PaymentConfiguration,
    | "id"
    | "method"
    | "property_name"
    | "integration_status"
    | "integration_message"
    | "integration_checked_at"
    | "c2b_registered_at"
    | "has_credentials"
    | "has_passkey"
    | "callback_urls"
    | "created_at"
    | "updated_at"
  >
>;

export function useSaveConfiguration() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: ({ id, ...input }: ConfigurationInput & { id?: string }) =>
      id
        ? api.patch<PaymentConfiguration>(`/payment-configurations/${id}/`, input)
        : api.post<PaymentConfiguration>("/payment-configurations/", input),
    onSuccess: () => invalidate("payment-configurations"),
  });
}

export function useConfigurationAction() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: ({ id, action, body }: { id: string; action: "credentials" | "test" | "register-c2b"; body?: object }) =>
      api.post<PaymentConfiguration>(`/payment-configurations/${id}/${action}/`, body ?? {}),
    onSuccess: () => invalidate("payment-configurations", "provider-events"),
  });
}

export function useProviderEvents(configId: string, enabled = true) {
  const key = useOrgKey();
  return useQuery({
    queryKey: key("provider-events", configId),
    queryFn: () => api.get<ProviderEvent[]>(`/payment-configurations/${configId}/events/`),
    enabled,
  });
}

export function usePaymentInstructions(leaseId: string, enabled = true) {
  const key = useOrgKey();
  return useQuery({
    queryKey: key("payment-configurations", "instructions", leaseId),
    queryFn: () => api.get<PaymentInstructions>(`/leases/${leaseId}/payment-instructions/`),
    enabled,
  });
}

export function usePaymentRequests(params: { page?: number; lease?: string }, enabled = true) {
  const key = useOrgKey();
  return useQuery({
    queryKey: key("payment-requests", params),
    queryFn: () => api.get<Paginated<PaymentRequest>>("/payment-requests/", params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useRequestMpesaPayment() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: (input: { lease: string; amount: string; phone: string }) => api.post<PaymentRequest>("/payment-requests/", input),
    onSuccess: () => invalidate("payment-requests"),
  });
}

export function useStatementImports(page = 1, enabled = true) {
  const key = useOrgKey();
  return useQuery({
    queryKey: key("statement-imports", page),
    queryFn: () => api.get<Paginated<StatementImport>>("/statement-imports/", { page }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useImportStatement() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: ({ configuration, file }: { configuration: string; file: File }) => {
      const form = new FormData();
      form.append("configuration", configuration);
      form.append("file", file);
      return api.upload<StatementImport>("/statement-imports/", form);
    },
    onSuccess: () => invalidate(...MONEY_RESOURCES),
  });
}
