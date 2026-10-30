import { BedDouble, CalendarCheck, ChevronLeft, ChevronRight, Home, MapPin } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { bedroomsLabel, LISTINGS_PAGE_SIZE, type ListingSearch } from "@/features/listings/format";
import { formatDay, formatMoney } from "@/lib/utils";
import type { Paginated, PublicListing } from "@/types/api";

// Rendered on the server so search engines and link previews see every home.

export function ListingResults({ data, search }: { data: Paginated<PublicListing>; search: ListingSearch }) {
  if (data.results.length === 0) {
    return <EmptyState icon={Home} title="No homes match" description="Try another area, a higher rent or fewer bedrooms." />;
  }
  return (
    <>
      <p className="mb-3 text-sm text-muted-foreground">
        {data.count} home{data.count === 1 ? "" : "s"} to let
      </p>
      <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {data.results.map((l) => (
          <ListingCard key={l.id} listing={l} />
        ))}
      </ul>
      <Pager search={search} count={data.count} />
    </>
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

/** Previous/next as real links, so crawlers can follow every page of results. */
function Pager({ search, count }: { search: ListingSearch; count: number }) {
  const page = search.page ?? 1;
  const pages = Math.max(1, Math.ceil(count / LISTINGS_PAGE_SIZE));
  if (pages <= 1) return null;
  const href = (p: number) => {
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...search, page: p > 1 ? p : undefined })) if (v) query.set(k, String(v));
    const qs = query.toString();
    return qs ? `/listings?${qs}` : "/listings";
  };
  const from = (page - 1) * LISTINGS_PAGE_SIZE + 1;
  const to = Math.min(page * LISTINGS_PAGE_SIZE, count);
  return (
    <nav aria-label="Pages of results" className="flex items-center justify-between gap-4 px-1 pt-4 text-sm text-muted-foreground">
      <p>
        {from}–{to} of {count}
      </p>
      <div className="flex gap-2">
        {page > 1 && (
          <Button asChild variant="outline" size="sm">
            <Link href={href(page - 1)} rel="prev" scroll={false}>
              <ChevronLeft aria-hidden /> Previous
            </Link>
          </Button>
        )}
        {page < pages && (
          <Button asChild variant="outline" size="sm">
            <Link href={href(page + 1)} rel="next" scroll={false}>
              Next <ChevronRight aria-hidden />
            </Link>
          </Button>
        )}
      </div>
    </nav>
  );
}
