"use client";

import { BedDouble, CalendarCheck, Home, MapPin, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { Input, NativeSelect } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { type ListingSearch, usePublicListings } from "@/features/listings/api";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { errorMessage } from "@/lib/api/errors";
import { formatDay, formatMoney } from "@/lib/utils";
import type { PublicListing } from "@/types/api";

export function bedroomsLabel(n: number, category: string) {
  return n === 0 ? category : `${n} bedroom${n === 1 ? "" : "s"}`;
}

export function PublicListings() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = React.useState(params.get("q") ?? "");
  const debounced = useDebouncedValue(q, 350);
  const search: ListingSearch = {
    q: debounced || undefined,
    max_rent: params.get("max_rent") ?? undefined,
    bedrooms: params.get("bedrooms") ?? undefined,
    landlord: params.get("landlord") ?? undefined,
    ordering: params.get("ordering") ?? undefined,
    page: Number(params.get("page") ?? 1),
  };
  const listings = usePublicListings(search);

  const update = React.useCallback(
    (changes: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(changes)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      if (!("page" in changes)) next.delete("page");
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );
  React.useEffect(() => {
    if ((params.get("q") ?? "") !== debounced) update({ q: debounced || null });
  }, [debounced, params, update]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">Find a home</h1>
      <p className="mt-1 text-muted-foreground">Homes to let from landlords using Nexora. Ask a question or book a viewing in a minute.</p>

      <div className="mt-6 flex flex-col gap-3 md:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input aria-label="Search by area or name" placeholder="Area, town or building (e.g. Westlands)" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <NativeSelect aria-label="Bedrooms" className="md:w-40" value={params.get("bedrooms") ?? ""} onChange={(e) => update({ bedrooms: e.target.value || null })}>
          <option value="">Any size</option>
          <option value="1">1+ bedrooms</option>
          <option value="2">2+ bedrooms</option>
          <option value="3">3+ bedrooms</option>
        </NativeSelect>
        <NativeSelect aria-label="Maximum rent" className="md:w-44" value={params.get("max_rent") ?? ""} onChange={(e) => update({ max_rent: e.target.value || null })}>
          <option value="">Any rent</option>
          {[10000, 20000, 30000, 50000, 80000, 120000].map((v) => <option key={v} value={v}>Up to {v.toLocaleString("en-KE")}</option>)}
        </NativeSelect>
        <NativeSelect aria-label="Sort" className="md:w-44" value={params.get("ordering") ?? ""} onChange={(e) => update({ ordering: e.target.value || null })}>
          <option value="">Newest first</option>
          <option value="rent">Rent: low to high</option>
          <option value="-rent">Rent: high to low</option>
        </NativeSelect>
      </div>

      <div className="mt-6">
        {listings.isPending ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-80 w-full" />)}</div>
        ) : listings.isError ? (
          <ErrorState message={errorMessage(listings.error)} onRetry={() => listings.refetch()} />
        ) : listings.data.results.length === 0 ? (
          <EmptyState icon={Home} title="No homes match" description="Try another area, a higher rent or fewer bedrooms." />
        ) : (
          <>
            <p className="mb-3 text-sm text-muted-foreground">{listings.data.count} home{listings.data.count === 1 ? "" : "s"} to let</p>
            <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {listings.data.results.map((l) => <ListingCard key={l.id} listing={l} />)}
            </ul>
            <Pagination page={search.page ?? 1} pageSize={25} count={listings.data.count} onPageChange={(p) => update({ page: String(p) })} />
          </>
        )}
      </div>
    </div>
  );
}

function ListingCard({ listing: l }: { listing: PublicListing }) {
  const photo = l.photos[0];
  return (
    <li>
      <Link href={`/listings/${l.id}`} className="group block overflow-hidden rounded-xl border bg-card transition-shadow hover:shadow-md">
        <div className="aspect-[4/3] bg-muted">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element -- served by the API, not optimisable
            <img src={photo.url} alt="" className="size-full object-cover" loading="lazy" />
          ) : (
            <div className="flex size-full items-center justify-center text-muted-foreground"><Home className="size-8" aria-hidden /></div>
          )}
        </div>
        <div className="space-y-1.5 p-4">
          <p className="text-lg font-semibold">{formatMoney(l.rent, l.currency)} <span className="text-sm font-normal text-muted-foreground">/ month</span></p>
          <p className="font-medium group-hover:underline">{l.title}</p>
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1"><BedDouble className="size-4" aria-hidden />{bedroomsLabel(l.bedrooms, l.category)}</span>
            <span className="inline-flex items-center gap-1"><MapPin className="size-4" aria-hidden />{[l.town, l.county].filter(Boolean).join(", ")}</span>
          </p>
          <p className="inline-flex items-center gap-1 text-sm text-accent-strong">
            <CalendarCheck className="size-4" aria-hidden />
            {l.available_from ? `Available from ${formatDay(l.available_from)}` : "Available now"}
          </p>
        </div>
      </Link>
    </li>
  );
}
