"use client";

import { Building2, MapPin, Plus, Search } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { PageHeader } from "@/components/layout/page-header";
import { useOrganization } from "@/components/providers/organization-provider";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { useProperties } from "@/features/properties/api";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { errorMessage } from "@/lib/api/errors";
import { PROPERTY_TYPE } from "@/lib/labels";

import { PropertyFormDialog } from "./property-form-dialog";

export function PropertiesPage() {
  const { can, current } = useOrganization();
  const [search, setSearch] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [creating, setCreating] = React.useState(false);
  const debounced = useDebouncedValue(search, 300);
  const allowed = can("properties.view");
  const properties = useProperties({ search: debounced, page }, allowed);

  if (!allowed) return <Alert variant="error" title="You don't have permission to view properties." />;
  const assignedOnly = current.access_scope === "assigned" && current.role !== "owner";

  return (
    <>
      <PageHeader
        title="Properties"
        description={
          assignedOnly
            ? "Properties you have been assigned to."
            : "Buildings and estates your organization manages."
        }
        actions={
          can("properties.manage") && (
            <Button onClick={() => setCreating(true)}>
              <Plus /> Add property
            </Button>
          )
        }
      />
      <div className="relative mb-4 max-w-md">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          aria-label="Search properties"
          placeholder="Search by name, reference or location"
          className="pl-9"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>

      {properties.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-44 w-full" />
          ))}
        </div>
      ) : properties.isError ? (
        <ErrorState message={errorMessage(properties.error)} onRetry={() => properties.refetch()} />
      ) : properties.data.results.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={debounced ? "No matching properties" : "No properties yet"}
          description={
            debounced
              ? "Try a different search."
              : assignedOnly
                ? "Ask an owner to assign you to a property."
                : "Add your first property to start setting up units and tenants."
          }
          action={
            !debounced &&
            can("properties.manage") && (
              <Button onClick={() => setCreating(true)}>
                <Plus /> Add property
              </Button>
            )
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {properties.data.results.map((p) => {
            const occupancy = p.unit_count ? Math.round((p.occupied_count / p.unit_count) * 100) : 0;
            return (
              <Link
                key={p.id}
                href={`/dashboard/properties/${p.id}`}
                className="group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Card className="h-full transition-shadow group-hover:shadow-md">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{p.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {p.reference} · {PROPERTY_TYPE[p.property_type]}
                        </p>
                      </div>
                      {!p.is_active && <Badge variant="muted">Inactive</Badge>}
                    </div>
                    {(p.town || p.county) && (
                      <p className="flex items-center gap-1 text-sm text-muted-foreground">
                        <MapPin className="size-3.5" aria-hidden />
                        {[p.town, p.county].filter(Boolean).join(", ")}
                      </p>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-3 gap-2 text-center text-sm">
                      <Metric label="Units" value={p.unit_count} />
                      <Metric label="Occupied" value={p.occupied_count} />
                      <Metric label="Available" value={p.available_count} />
                    </div>
                    <div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                        <div className="h-full rounded-full bg-accent" style={{ width: `${occupancy}%` }} />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {p.unit_count ? `${occupancy}% occupied` : "No units yet"}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
      {properties.data && (
        <Pagination page={page} pageSize={25} count={properties.data.count} onPageChange={setPage} />
      )}
      <PropertyFormDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-muted/60 py-2">
      <p className="text-lg font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
