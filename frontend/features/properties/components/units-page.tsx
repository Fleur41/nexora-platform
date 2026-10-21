"use client";

import { DoorOpen, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { PageHeader } from "@/components/layout/page-header";
import { useOrganization } from "@/components/providers/organization-provider";
import { Alert } from "@/components/ui/alert";
import { Input, NativeSelect } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { UnitStatusBadge } from "@/components/ui/status";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePropertyOptions, useUnits, useUnitTypes } from "@/features/properties/api";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { errorMessage } from "@/lib/api/errors";
import { UNIT_STATUS } from "@/lib/labels";
import { formatMoney } from "@/lib/utils";
import type { Unit, UnitStatus } from "@/types/api";

import { UnitDetailDialog } from "./unit-dialogs";

export function UnitsPage() {
  const { can, current } = useOrganization();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const property = params.get("property") ?? "";
  const status = (params.get("status") ?? "") as UnitStatus | "";
  const [search, setSearch] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [selected, setSelected] = React.useState<Unit | null>(null);
  const debounced = useDebouncedValue(search, 300);
  const allowed = can("properties.view");
  const properties = usePropertyOptions(allowed);
  const units = useUnits({ property, status, search: debounced, page }, allowed);
  const unitTypes = useUnitTypes(selected?.property, selected !== null);

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setPage(1);
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`);
  };

  if (!allowed) return <Alert variant="error" title="You don't have permission to view units." />;

  return (
    <>
      <PageHeader title="Units" description="Every unit across the properties you can access." />
      <div className="mb-4 flex flex-col gap-3 md:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            aria-label="Search units"
            placeholder="Search by unit number or property"
            className="pl-9"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <NativeSelect aria-label="Filter by property" className="md:w-60" value={property} onChange={(e) => setFilter("property", e.target.value)}>
          <option value="">All properties</option>
          {properties.data?.results.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="Filter by status" className="md:w-56" value={status} onChange={(e) => setFilter("status", e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(UNIT_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </NativeSelect>
      </div>

      {units.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : units.isError ? (
        <ErrorState message={errorMessage(units.error)} onRetry={() => units.refetch()} />
      ) : units.data.results.length === 0 ? (
        <EmptyState
          icon={DoorOpen}
          title="No units found"
          description={
            debounced || property || status
              ? "Try different filters."
              : "Add units from a property's page."
          }
        />
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Unit</TableHead>
                <TableHead className="hidden md:table-cell">Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden sm:table-cell">Asking rent</TableHead>
                <TableHead className="hidden lg:table-cell">Tenant</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {units.data.results.map((u) => (
                <TableRow key={u.id} className="cursor-pointer" onClick={() => setSelected(u)}>
                  <TableCell>
                    <button className="text-left font-medium hover:underline" onClick={() => setSelected(u)}>
                      {u.number}
                    </button>
                    <p className="text-xs text-muted-foreground">
                      <Link href={`/dashboard/properties/${u.property}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                        {u.property_name}
                      </Link>
                    </p>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{u.unit_type_name}</TableCell>
                  <TableCell>
                    <UnitStatusBadge status={u.status} />
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {formatMoney(u.market_rent, current.organization.currency)}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {u.current_lease?.tenant_name ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {units.data && <Pagination page={page} pageSize={25} count={units.data.count} onPageChange={setPage} />}
      <UnitDetailDialog
        unit={selected}
        unitTypes={unitTypes.data?.results ?? []}
        onOpenChange={(o) => !o && setSelected(null)}
      />
    </>
  );
}
