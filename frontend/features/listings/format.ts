import { formatMoney } from "@/lib/utils";
import type { PublicListing } from "@/types/api";

// Shared by the server-rendered listing pages and the client components inside them.

export type ListingSearch = {
  q?: string;
  max_rent?: string;
  bedrooms?: string;
  landlord?: string;
  ordering?: string;
  page?: number;
};

/** Django's default page size for the public listings. */
export const LISTINGS_PAGE_SIZE = 25;

export function bedroomsLabel(n: number, category: string) {
  return n === 0 ? category : `${n} bedroom${n === 1 ? "" : "s"}`;
}

/** "2 bedrooms to let in Westlands, Nairobi for Ksh 45,000 a month" */
export function listingSummary(l: PublicListing) {
  const where = [l.town, l.county].filter(Boolean).join(", ");
  return `${bedroomsLabel(l.bedrooms, l.category)} to let${where ? ` in ${where}` : ""} for ${formatMoney(l.rent, l.currency)} a month`;
}
