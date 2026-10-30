"use client";

import { FilePlus2, FileText, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { PageHeader } from "@/components/layout/page-header";
import { useOrganization } from "@/components/providers/organization-provider";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { LeaseStatusBadge } from "@/components/ui/status";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLeases } from "@/features/leases/api";
import { usePropertyOptions } from "@/features/properties/api";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { errorMessage } from "@/lib/api/errors";
import { LEASE_STATUS } from "@/lib/labels";
import { formatDay, formatMoney } from "@/lib/utils";
import type { LeaseStatus } from "@/types/api";

const EXPIRING_DAYS = 60;

export function LeasesPage() {
  const { can, current } = useOrganization();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const view = params.get("view") === "expiring" ? "expiring" : "all";
  const [status, setStatus] = React.useState<LeaseStatus | "">("active");
  const [property, setProperty] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [page, setPage] = React.useState(1);
  const debounced = useDebouncedValue(search, 300);
  const allowed = can("leases.view");
  const properties = usePropertyOptions(allowed);
  const leases = useLeases(
    view === "expiring"
      ? { expiring_within_days: EXPIRING_DAYS, property, search: debounced, page }
      : { status, property, search: debounced, page, ordering: "-start_date" },
    allowed,
  );

  if (!allowed) return <Alert variant="error" title="You don't have permission to view leases." />;
  const currency = current.organization.currency;

  return (
    <>
      <PageHeader
        title="Leases"
        description="Tenancy agreements, rent terms and their history."
        actions={
          can("leases.manage") && (
            <Button asChild>
              <Link href="/dashboard/leases/new">
                <FilePlus2 /> New lease
              </Link>
            </Button>
          )
        }
      />
      <Tabs
        value={view}
        onValueChange={(v) => {
          setPage(1);
          router.replace(v === "all" ? pathname : `${pathname}?view=${v}`);
        }}
      >
        <TabsList className="mb-4">
          <TabsTrigger value="all">All leases</TabsTrigger>
          <TabsTrigger value="expiring">Expiring in {EXPIRING_DAYS} days</TabsTrigger>
        </TabsList>
        {/* One panel for both tabs: the tab only changes the query. */}
        <TabsContent value={view}>
      <div className="mb-4 flex flex-col gap-3 md:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            aria-label="Search leases"
            placeholder="Search by reference, tenant or unit"
            className="pl-9"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <NativeSelect aria-label="Filter by property" className="md:w-60" value={property} onChange={(e) => { setProperty(e.target.value); setPage(1); }}>
          <option value="">All properties</option>
          {properties.data?.results.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </NativeSelect>
        {view === "all" && (
          <NativeSelect aria-label="Filter by status" className="md:w-44" value={status} onChange={(e) => { setStatus(e.target.value as LeaseStatus | ""); setPage(1); }}>
            <option value="">All statuses</option>
            {Object.entries(LEASE_STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </NativeSelect>
        )}
      </div>

      {leases.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : leases.isError ? (
        <ErrorState message={errorMessage(leases.error)} onRetry={() => leases.refetch()} />
      ) : leases.data.results.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={view === "expiring" ? "Nothing expiring soon" : "No leases found"}
          description={
            view === "expiring"
              ? `No fixed-term leases end in the next ${EXPIRING_DAYS} days.`
              : "Create a lease to let a unit to a tenant."
          }
        />
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tenant</TableHead>
                <TableHead className="hidden md:table-cell">Unit</TableHead>
                <TableHead className="hidden lg:table-cell">Term</TableHead>
                <TableHead className="hidden sm:table-cell">Rent</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leases.data.results.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>
                    <Link href={`/dashboard/leases/${l.id}`} className="font-medium hover:underline">
                      {l.tenant_name}
                    </Link>
                    <p className="text-xs text-muted-foreground">{l.reference}</p>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {l.unit_number}
                    <p className="text-xs text-muted-foreground">{l.property_name}</p>
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap text-muted-foreground lg:table-cell">
                    {formatDay(l.start_date)} – {l.ended_on ? formatDay(l.ended_on) : l.end_date ? formatDay(l.end_date) : "Periodic"}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{formatMoney(l.current_rent, currency)}</TableCell>
                  <TableCell>
                    <LeaseStatusBadge status={l.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {leases.data && <Pagination page={page} pageSize={25} count={leases.data.count} onPageChange={setPage} />}
        </TabsContent>
      </Tabs>
    </>
  );
}
