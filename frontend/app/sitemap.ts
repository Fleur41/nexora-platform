import type { MetadataRoute } from "next";

import { getAllPublicListings, siteOrigin } from "@/lib/api/server";

/** The landing page, the listings search and every home currently advertised. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = await siteOrigin();
  const url = (path: string) => new URL(path, origin).toString();
  const listings = await getAllPublicListings();
  return [
    { url: url("/"), changeFrequency: "monthly", priority: 1 },
    { url: url("/listings"), changeFrequency: "daily", priority: 0.9 },
    ...listings.map((l) => ({
      url: url(`/listings/${l.id}`),
      lastModified: l.published_at ?? undefined,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
  ];
}
