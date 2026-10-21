"use client";

import { Search, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { PageHeader } from "@/components/layout/page-header";
import { useOrganization } from "@/components/providers/organization-provider";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useTenants } from "@/features/tenants/api";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { errorMessage } from "@/lib/api/errors";
import { initials } from "@/lib/utils";

import { TenantFormDialog } from "./tenant-form-dialog";

export function TenantsPage() {
  const { can } = useOrganization();
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState<"active" | "archived">("active");
  const [page, setPage] = React.useState(1);
  const [creating, setCreating] = React.useState(false);
  const debounced = useDebouncedValue(search, 300);
  const allowed = can("tenants.view");
  const tenants = useTenants({ search: debounced, status, page }, allowed);

  if (!allowed) return <Alert variant="error" title="You don't have permission to view tenants." />;

  return (
    <>
      <PageHeader
        title="Tenants"
        description="People and businesses renting from you. History is kept after they move out."
        actions={
          can("tenants.manage") && (
            <Button onClick={() => setCreating(true)}>
              <UserPlus /> Register tenant
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            aria-label="Search tenants"
            placeholder="Search by name, phone, email or ID"
            className="pl-9"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <NativeSelect
          aria-label="Filter by status"
          className="sm:w-48"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as "active" | "archived");
            setPage(1);
          }}
        >
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </NativeSelect>
      </div>

      {tenants.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : tenants.isError ? (
        <ErrorState message={errorMessage(tenants.error)} onRetry={() => tenants.refetch()} />
      ) : tenants.data.results.length === 0 ? (
        <EmptyState
          icon={Users}
          title={debounced ? "No matching tenants" : status === "archived" ? "No archived tenants" : "No tenants yet"}
          description={debounced ? "Try a different search." : "Register a tenant, then create their lease."}
          action={
            !debounced &&
            status === "active" &&
            can("tenants.manage") && (
              <Button onClick={() => setCreating(true)}>
                <UserPlus /> Register tenant
              </Button>
            )
          }
        />
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tenant</TableHead>
                <TableHead className="hidden sm:table-cell">Phone</TableHead>
                <TableHead className="hidden md:table-cell">Email</TableHead>
                <TableHead>Leases</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenants.data.results.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <Link href={`/dashboard/tenants/${t.id}`} className="flex items-center gap-3 hover:underline">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">
                        {initials(t.full_name)}
                      </span>
                      <span className="font-medium">{t.full_name}</span>
                    </Link>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{t.phone}</TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">{t.email || "—"}</TableCell>
                  <TableCell>
                    {t.active_lease_count ? (
                      <Badge variant="accent">{t.active_lease_count} active</Badge>
                    ) : (
                      <Badge variant="muted">None active</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {tenants.data && <Pagination page={page} pageSize={25} count={tenants.data.count} onPageChange={setPage} />}
      <TenantFormDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
