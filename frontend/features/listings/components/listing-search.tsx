"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { Input, NativeSelect } from "@/components/ui/input";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { cn } from "@/lib/utils";

/**
 * The search bar for the public listings. Filters live in the URL; changing one re-renders the
 * server-rendered results passed in as children, which stay on screen (dimmed) until the new
 * ones arrive.
 */
export function ListingSearch({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = React.useTransition();
  const [q, setQ] = React.useState(params.get("q") ?? "");
  const debounced = useDebouncedValue(q, 350);

  const update = React.useCallback(
    (changes: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(changes)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      next.delete("page");
      const qs = next.toString();
      startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
    },
    [params, pathname, router],
  );
  React.useEffect(() => {
    if ((params.get("q") ?? "") !== debounced) update({ q: debounced || null });
  }, [debounced, params, update]);

  return (
    <>
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
          {[10000, 20000, 30000, 50000, 80000, 120000].map((v) => (
            <option key={v} value={v}>
              Up to {v.toLocaleString("en-KE")}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="Sort" className="md:w-44" value={params.get("ordering") ?? ""} onChange={(e) => update({ ordering: e.target.value || null })}>
          <option value="">Newest first</option>
          <option value="rent">Rent: low to high</option>
          <option value="-rent">Rent: high to low</option>
        </NativeSelect>
      </div>
      <div className={cn("mt-6 transition-opacity", pending && "opacity-60")} aria-busy={pending}>
        {children}
      </div>
    </>
  );
}
