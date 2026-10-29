import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api/client";
import { useInvalidateOrg, useOrgKey } from "@/lib/org-query";
import type { Enquiry, EnquiryKind, EnquiryOutcome, EnquiryStatus, Listing, Paginated, PublicListing, TimeOfDay } from "@/types/api";

// --- Public website (no organization, no sign-in) --------------------------------------------

const open = { scoped: false } as const;

export type ListingSearch = {
  q?: string;
  min_rent?: string;
  max_rent?: string;
  bedrooms?: string;
  landlord?: string;
  ordering?: string;
  page?: number;
};

export function usePublicListings(search: ListingSearch) {
  return useQuery({
    queryKey: ["public-listings", search],
    queryFn: () => api.get<Paginated<PublicListing>>("/public/listings/", search, open),
    placeholderData: keepPreviousData,
  });
}

export function usePublicListing(id: string) {
  return useQuery({
    queryKey: ["public-listings", "detail", id],
    queryFn: () => api.get<PublicListing>(`/public/listings/${id}/`, undefined, open),
    retry: false,
  });
}

export type EnquiryInput = {
  kind: EnquiryKind;
  name: string;
  phone: string;
  email: string;
  message: string;
  preferred_date?: string | null;
  preferred_time?: TimeOfDay;
  website: string; // honeypot: always empty from real people
};

export function useSubmitEnquiry(listingId: string) {
  return useMutation({
    mutationFn: (input: EnquiryInput) =>
      api.post<{ reference: string | null }>(`/public/listings/${listingId}/enquiries/`, input, open),
  });
}

// --- Staff ----------------------------------------------------------------------------------

export function useListings(params: { page?: number; search?: string }, enabled = true) {
  const key = useOrgKey();
  return useQuery({
    queryKey: key("listings", params),
    queryFn: () => api.get<Paginated<Listing>>("/listings/", params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function usePhotoOptions(unit: string) {
  const key = useOrgKey();
  return useQuery({
    queryKey: key("listings", "photo-options", unit),
    queryFn: () => api.get<{ id: string; title: string; of: "unit" | "property" }[]>("/listings/photo-options/", { unit }),
    enabled: Boolean(unit),
  });
}

export type ListingInput = {
  unit?: string;
  title: string;
  description: string;
  is_published: boolean;
  available_from: string | null;
  contact_phone: string;
  photo_ids: string[];
};

export function useSaveListing() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: ({ id, ...input }: ListingInput & { id?: string }) =>
      id ? api.patch<Listing>(`/listings/${id}/`, input) : api.post<Listing>("/listings/", input),
    onSuccess: () => invalidate("listings", "audit-logs"),
  });
}

export function useEnquiries(params: { page?: number; status?: EnquiryStatus | ""; open?: boolean; kind?: EnquiryKind | "" }, enabled = true) {
  const key = useOrgKey();
  return useQuery({
    queryKey: key("enquiries", params),
    queryFn: () => api.get<Paginated<Enquiry>>("/enquiries/", params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useEnquiry(id: string) {
  const key = useOrgKey();
  return useQuery({ queryKey: key("enquiries", "detail", id), queryFn: () => api.get<Enquiry>(`/enquiries/${id}/`) });
}

export function useUpdateEnquiry() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string; status?: EnquiryStatus; viewing_at?: string | null; outcome?: EnquiryOutcome; staff_notes?: string }) =>
      api.patch<Enquiry>(`/enquiries/${id}/`, input),
    onSuccess: () => invalidate("enquiries", "listings", "audit-logs"),
  });
}
