import type { Metadata } from "next";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { ListingSearch } from "@/features/listings/components/listing-search";
import { ListingResults } from "@/features/listings/components/public-listings";
import type { ListingSearch as Search } from "@/features/listings/format";
import { getPublicListings } from "@/lib/api/server";

export const metadata: Metadata = {
  title: "Homes to let",
  description: "Houses and apartments to let from landlords using Nexora. Book a viewing in a minute.",
  alternates: { canonical: "/listings" },
};

export default function Page({ searchParams }: PageProps<"/listings">) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">Find a home</h1>
      <p className="mt-1 text-muted-foreground">Homes to let from landlords using Nexora. Ask a question or book a viewing in a minute.</p>
      <Suspense fallback={<ResultsSkeleton />}>
        <Results searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

const FILTERS = ["q", "max_rent", "bedrooms", "landlord", "ordering"] as const;

async function Results({ searchParams }: Pick<PageProps<"/listings">, "searchParams">) {
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
  const search: Search = Object.fromEntries(FILTERS.map((k) => [k, one(params[k])]));
  const page = Number(one(params.page));
  if (Number.isInteger(page) && page > 1) search.page = page;
  const data = await getPublicListings(search);
  return (
    <ListingSearch>
      <ListingResults data={data} search={search} />
    </ListingSearch>
  );
}

function ResultsSkeleton() {
  return (
    <div className="mt-6 space-y-6">
      <Skeleton className="h-10 w-full" />
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-80 w-full" />
        ))}
      </div>
    </div>
  );
}
