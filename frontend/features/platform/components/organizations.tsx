"use client";

import { AlarmClock, Building2, CircleDollarSign, Receipt } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat } from "@/components/ui/stat";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePlatformOrganizations, usePlatformOverview } from "@/features/platform/api";
import { SUBSCRIPTION_STATUS } from "@/features/subscription/components/subscription-page";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { errorMessage } from "@/lib/api/errors";
import { formatDay, formatMoney } from "@/lib/utils";
import type { PlatformOrganization } from "@/types/api";

export function PlatformOrganizations() {
  const overview = usePlatformOverview();
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState("");
  const q = useDebouncedValue(search, 300);
  const orgs = usePlatformOrganizations({ search: q || undefined, subscription_status: status || undefined });
  const o = overview.data;
  return (
    <>
      <PageHeader title="Organizations" description="Every landlord and agency on Nexora, their plan and where they stand." />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={Building2} label="Organizations" loading={overview.isPending} value={o ? String(o.organizations) : ""}
          hint={o ? `${o.units} units · ${o.suspended} suspended` : undefined} />
        <Stat icon={CircleDollarSign} label="Monthly recurring revenue" loading={overview.isPending} value={o ? formatMoney(o.monthly_recurring_revenue) : ""}
          hint={o ? `${o.subscriptions.active} paying · ${o.subscriptions.trialing} on trial` : undefined} />
        <Stat icon={Receipt} label="Unpaid invoices" loading={overview.isPending} value={o ? formatMoney(o.open_amount) : ""} href="/platform/invoices"
          hint={o ? `${o.open_invoices} open · ${formatMoney(o.overdue_amount)} overdue` : undefined} />
        <Stat icon={AlarmClock} label="Trials ending this week" loading={overview.isPending} value={o ? String(o.trials_ending_7_days) : ""}
          hint={o ? `${o.subscriptions.past_due} overdue · ${o.subscriptions.lapsed} read-only` : undefined} />
      </div>
      <Card>
        <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row">
          <Input aria-label="Search organizations" placeholder="Search by name, email or account number" value={search} onChange={(e) => setSearch(e.target.value)} className="sm:max-w-sm" />
          <NativeSelect aria-label="Subscription status" value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-48">
            <option value="">All statuses</option>
            {Object.entries(SUBSCRIPTION_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </NativeSelect>
        </CardContent>
        <CardContent className="px-0">
          {orgs.isPending ? (
            <div className="px-6"><Skeleton className="h-48 w-full" /></div>
          ) : orgs.isError ? (
            <div className="px-6"><ErrorState message={errorMessage(orgs.error)} onRetry={() => orgs.refetch()} /></div>
          ) : !orgs.data.length ? (
            <EmptyState icon={Building2} title="No organizations match" description="Try a different search or status." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Organization</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead className="text-right">Units</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Access until</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>{orgs.data.map((org) => <OrganizationRow key={org.id} org={org} />)}</TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function OrganizationRow({ org }: { org: PlatformOrganization }) {
  const status = org.subscription_status ? SUBSCRIPTION_STATUS[org.subscription_status] : null;
  return (
    <TableRow>
      <TableCell>
        <Link href={`/platform/organizations/${org.id}`} className="font-medium hover:underline">{org.name}</Link>
        <p className="text-xs text-muted-foreground">{org.account_code ?? "—"} · {org.email || "no email"}</p>
      </TableCell>
      <TableCell>{org.plan ?? "—"}{org.complimentary && <Badge variant="muted" className="ml-2">Complimentary</Badge>}</TableCell>
      <TableCell className="text-right tabular-nums">{org.units}{org.unit_limit ? ` / ${org.unit_limit}` : ""}</TableCell>
      <TableCell className="space-x-1">
        {org.status === "suspended" && <Badge variant="destructive">Suspended</Badge>}
        {status && <Badge variant={status.variant}>{status.label}</Badge>}
      </TableCell>
      <TableCell>{formatDay(org.subscription_status === "trialing" ? org.trial_ends_on : org.paid_until)}</TableCell>
    </TableRow>
  );
}
