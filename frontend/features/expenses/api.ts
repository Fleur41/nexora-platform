import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api/client";
import { useInvalidateOrg, useOrgKey } from "@/lib/org-query";
import type { Expense, ExpenseCategory, ExpenseInput, ExpenseStatus, ExpenseSummary, Paginated } from "@/types/api";

// Expenses feed the financial reports, so refresh those too.
const EXPENSE_RESOURCES = ["expenses", "reports"];

export type ExpenseListParams = {
  search?: string;
  category?: ExpenseCategory | "";
  property?: string;
  organization_wide?: boolean;
  status?: ExpenseStatus | "";
  start?: string;
  end?: string;
  page?: number;
  page_size?: number;
};

export function useExpenses(params: ExpenseListParams, enabled = true) {
  const key = useOrgKey();
  return useQuery({
    queryKey: key("expenses", params),
    queryFn: () => api.get<Paginated<Expense>>("/expenses/", params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useExpenseSummary(params: Omit<ExpenseListParams, "page" | "page_size" | "status">, enabled = true) {
  const key = useOrgKey();
  return useQuery({
    queryKey: key("expenses", "summary", params),
    queryFn: () => api.get<ExpenseSummary>("/expenses/summary/", params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useSaveExpense() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: ExpenseInput }) =>
      id ? api.patch<Expense>(`/expenses/${id}/`, input) : api.post<Expense>("/expenses/", input),
    onSuccess: () => invalidate(...EXPENSE_RESOURCES),
  });
}

export function useVoidExpense() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post<Expense>(`/expenses/${id}/void/`, { reason }),
    onSuccess: () => invalidate(...EXPENSE_RESOURCES),
  });
}
