import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { PublicListingDetail } from "@/features/listings/components/public-listing-detail";
import { listingSummary } from "@/features/listings/format";
import { getPublicListing, siteOrigin } from "@/lib/api/server";

export async function generateMetadata({ params }: PageProps<"/listings/[id]">): Promise<Metadata> {
  const { id } = await params;
  const listing = await getPublicListing(id);
  if (!listing) return { title: "Home no longer advertised", robots: { index: false } };
  const summary = `${listingSummary(listing)}.`;
  const text = listing.description.replace(/\s+/g, " ").trim();
  const full = text ? `${summary} ${text}` : summary;
  const description = full.length > 200 ? `${full.slice(0, 197).trimEnd()}…` : full;
  const photo = listing.photos[0];
  return {
    // Link previews and the sitemap need absolute URLs.
    metadataBase: await siteOrigin(),
    title: listing.title,
    description,
    alternates: { canonical: `/listings/${listing.id}` },
    openGraph: {
      type: "website",
      siteName: "Nexora",
      url: `/listings/${listing.id}`,
      title: listing.title,
      description,
      images: photo ? [{ url: photo.url, alt: listing.title }] : undefined,
    },
    twitter: { card: photo ? "summary_large_image" : "summary", title: listing.title, description },
  };
}

export default function Page({ params }: PageProps<"/listings/[id]">) {
  return (
    <Suspense fallback={<div className="mx-auto max-w-6xl px-4 py-10"><Skeleton className="h-[32rem] w-full" /></div>}>
      <Listing params={params} />
    </Suspense>
  );
}

async function Listing({ params }: Pick<PageProps<"/listings/[id]">, "params">) {
  const { id } = await params;
  const listing = await getPublicListing(id);
  if (!listing) notFound();
  return <PublicListingDetail listing={listing} />;
}
