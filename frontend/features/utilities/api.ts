import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api/client";
import { useInvalidateOrg, useOrgKey } from "@/lib/org-query";
import type { Meter, MeterReading, MeterUtility, Paginated } from "@/types/api";

export function useMeters(params: { "unit__property"?: string; utility?: string; is_active?: boolean }, enabled = true) {
  const key = useOrgKey();
  return useQuery({
    queryKey: key("meters", params),
    queryFn: () => api.get<Paginated<Meter>>("/meters/", { ...params, page_size: 100 }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useCreateMeter() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: (input: { unit: string; utility: MeterUtility; number: string }) => api.post<Meter>("/meters/", input),
    onSuccess: () => invalidate("meters"),
  });
}

export function useDeactivateMeter() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: (id: string) => api.post<Meter>(`/meters/${id}/deactivate/`),
    onSuccess: () => invalidate("meters"),
  });
}

export function useReadings(meterId: string | undefined, enabled = true) {
  const key = useOrgKey();
  return useQuery({
    queryKey: key("meter-readings", meterId),
    queryFn: () => api.get<Paginated<MeterReading>>("/meter-readings/", { meter: meterId, page_size: 100 }),
    enabled: enabled && Boolean(meterId),
  });
}

export function useBulkReadings() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: (input: { reading_date: string; readings: { meter: string; value: string; note?: string }[] }) =>
      api.post<MeterReading[]>("/meter-readings/bulk/", input),
    onSuccess: () => invalidate("meters", "meter-readings"),
  });
}

export function useDeleteReading() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/meter-readings/${id}/`),
    onSuccess: () => invalidate("meters", "meter-readings"),
  });
}
