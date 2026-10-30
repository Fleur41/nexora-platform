import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api/client";
import { useInvalidateOrg, useOrgKey } from "@/lib/org-query";
import type {
  Paginated,
  Property,
  PropertyAssignment,
  Unit,
  UnitStatus,
  UnitSummary,
  UnitType,
} from "@/types/api";

// Mutations touching units also change property counts and lease views.
const UNIT_RESOURCES = ["units", "properties", "unit-types", "leases"];

export type PropertyListParams = { search?: string; page?: number; is_active?: boolean; page_size?: number };

export function useProperties(params: PropertyListParams = {}, enabled = true) {
  const key = useOrgKey();
  return useQuery({
    queryKey: key("properties", params),
    queryFn: () => api.get<Paginated<Property>>("/properties/", params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** All accessible properties for pickers (first 100 is plenty for selection UIs). */
export function usePropertyOptions(enabled = true) {
  return useProperties({ page_size: 100, is_active: true }, enabled);
}

export function useProperty(id: string) {
  const key = useOrgKey();
  return useQuery({
    queryKey: key("properties", "detail", id),
    queryFn: () => api.get<Property>(`/properties/${id}/`),
  });
}

export function usePropertySummary(id: string) {
  const key = useOrgKey();
  return useQuery({
    queryKey: key("properties", "summary", id),
    queryFn: () =>
      api.get<{ units: UnitSummary; unit_types: { id: string; name: string; unit_count: number }[] }>(
        `/properties/${id}/summary/`,
      ),
  });
}

export type PropertyInput = Partial<
  Omit<Property, "id" | "reference" | "slug" | "unit_count" | "occupied_count" | "available_count" | "created_at" | "updated_at">
>;

export function useSaveProperty() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: ({ id, ...input }: PropertyInput & { id?: string }) =>
      id ? api.patch<Property>(`/properties/${id}/`, input) : api.post<Property>("/properties/", input),
    onSuccess: () => invalidate("properties"),
  });
}

export function useUnitTypes(propertyId: string | undefined, enabled = true) {
  const key = useOrgKey();
  return useQuery({
    queryKey: key("unit-types", propertyId),
    queryFn: () =>
      api.get<Paginated<UnitType>>("/unit-types/", { property: propertyId, page_size: 100 }),
    enabled: enabled && Boolean(propertyId),
  });
}

export type UnitTypeInput = Partial<Omit<UnitType, "id" | "unit_count" | "created_at">>;

export function useSaveUnitType() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: ({ id, ...input }: UnitTypeInput & { id?: string }) =>
      id ? api.patch<UnitType>(`/unit-types/${id}/`, input) : api.post<UnitType>("/unit-types/", input),
    onSuccess: () => invalidate("unit-types", "properties"),
  });
}

export function useDeleteUnitType() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/unit-types/${id}/`),
    onSuccess: () => invalidate("unit-types"),
  });
}

export type UnitListParams = {
  property?: string;
  status?: UnitStatus | "";
  unit_type?: string;
  search?: string;
  page?: number;
  page_size?: number;
};

export function useUnits(params: UnitListParams, enabled = true) {
  const key = useOrgKey();
  return useQuery({
    queryKey: key("units", params),
    queryFn: () => api.get<Paginated<Unit>>("/units/", params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useUnitSummary(enabled = true) {
  const key = useOrgKey();
  return useQuery({
    queryKey: key("units", "summary"),
    queryFn: () => api.get<UnitSummary>("/units/summary/"),
    enabled,
  });
}

export type UnitInput = Partial<
  Pick<Unit, "property" | "unit_type" | "number" | "floor" | "market_rent" | "water_meter_number" | "electricity_meter_number" | "floor_area" | "notes">
>;

export function useSaveUnit() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: ({ id, ...input }: UnitInput & { id?: string }) =>
      id ? api.patch<Unit>(`/units/${id}/`, input) : api.post<Unit>("/units/", input),
    onSuccess: () => invalidate(...UNIT_RESOURCES),
  });
}

export function useBulkCreateUnits() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: (input: {
      property: string;
      unit_type: string;
      prefix: string;
      start: number;
      count: number;
      floor: string;
    }) => api.post<{ created: number; numbers: string[] }>("/units/bulk/", input),
    onSuccess: () => invalidate(...UNIT_RESOURCES),
  });
}

export function useSetUnitStatus() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: ({ id, status, reason }: { id: string; status: UnitStatus; reason?: string }) =>
      api.post<Unit>(`/units/${id}/status/`, { status, reason }),
    onSuccess: () => invalidate(...UNIT_RESOURCES),
  });
}

export function useDeleteUnit() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/units/${id}/`),
    onSuccess: () => invalidate(...UNIT_RESOURCES),
  });
}

export function usePropertyAssignments(
  params: { property?: string; membership?: string },
  enabled = true,
) {
  const key = useOrgKey();
  return useQuery({
    queryKey: key("property-assignments", params),
    queryFn: () => api.get<PropertyAssignment[]>("/property-assignments/", params),
    enabled,
  });
}

export function useAssignProperty() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: (input: { property: string; membership: string }) =>
      api.post<PropertyAssignment>("/property-assignments/", input),
    onSuccess: () => invalidate("property-assignments"),
  });
}

export function useUnassignProperty() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/property-assignments/${id}/`),
    onSuccess: () => invalidate("property-assignments"),
  });
}
