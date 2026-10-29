"use client";

import {
  ArrowRight,
  Banknote,
  CalendarClock,
  DoorOpen,
  FileWarning,
  Receipt,
  ShieldCheck,
  Wallet,
  Home,
  MailPlus,
  Percent,
  ScrollText,
  UserCheck,
  Users,
} from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import { useOrganization } from "@/components/providers/organization-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat } from "@/components/ui/stat";
import { ErrorState } from "@/components/ui/states";
import { useAuditLogs } from "@/features/audit/api";
import { useBillingSummary } from "@/features/billing/api";
import { useDepositTotals } from "@/features/deposits/api";
import { usePaymentsSummary } from "@/features/payments/api";
import { useLeases } from "@/features/leases/api";
import { useProperties, useUnitSummary } from "@/features/properties/api";
import { describeAction } from "@/features/audit/describe";
import { useInvitations, useMembers } from "@/features/team/api";
import { errorMessage } from "@/lib/api/errors";
import { ROLE_LABELS } from "@/lib/roles";
import { formatDateTime, formatDay, formatMoney, plural } from "@/lib/utils";

export function DashboardOverview() {
  const { current, can } = useOrganization();
  const org = current.organization;
  const canTeam = can("members.view");
  const canAudit = can("audit.view");
  const members = useMembers({}, canTeam);
  const invitations = useInvitations({ status: "pending" }, canTeam);
  const audit = useAuditLogs({ page_size: 6, exclude_action: "support.request" }, canAudit);
  const canProperties = can("properties.view");
  const properties = useProperties({ page_size: 1, is_active: true }, canProperties);
  const units = useUnitSummary(canProperties);
  const expiring = useLeases({ expiring_within_days: 60, page_size: 5 }, can("leases.view"));
  const billing = useBillingSummary(can("billing.view"));
  const deposits = useDepositTotals(can("deposits.view"));
  const payments = usePaymentsSummary(can("payments.view"));

  return (
    <>
      <PageHeader
        title={org.name}
        description={`${current.support_until ? "You are viewing as Nexora support (read-only)" : `You are signed in as ${ROLE_LABELS[current.role]}`}. Currency ${org.currency} · ${org.timezone.replace("_", " ")}`}
      />

      {canProperties && (
        <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat
            icon={Home}
            label="Active properties"
            value={properties.data?.count ?? 0}
            loading={properties.isPending}
            href="/dashboard/properties"
          />
          <Stat
            icon={DoorOpen}
            label="Units"
            value={units.data?.total ?? 0}
            hint={units.data ? `${units.data.vacant} available` : undefined}
            loading={units.isPending}
            href="/dashboard/units"
          />
          <Stat
            icon={UserCheck}
            label="Occupied units"
            value={units.data?.occupied ?? 0}
            loading={units.isPending}
            href="/dashboard/units?status=occupied"
          />
          <Stat
            icon={Percent}
            label="Occupancy"
            value={
              units.data?.occupancy_rate === null || units.data === undefined
                ? "—"
                : `${units.data.occupancy_rate}%`
            }
            hint="Of lettable units"
            loading={units.isPending}
          />
        </div>
      )}

      {(can("billing.view") || can("deposits.view") || can("payments.view")) && (
        <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {can("billing.view") && (
            <>
              <Stat
                icon={Receipt}
                label="Billed this month"
                value={formatMoney(billing.data?.billed_this_month ?? 0, org.currency)}
                loading={billing.isPending}
                href="/dashboard/billing?tab=runs"
              />
              <Stat
                icon={Wallet}
                label="Outstanding"
                value={formatMoney(billing.data?.outstanding ?? 0, org.currency)}
                hint={billing.data ? plural(billing.data.outstanding_invoices, "open invoice") : undefined}
                loading={billing.isPending}
                href="/dashboard/billing"
              />
              <Stat
                icon={FileWarning}
                label="Overdue"
                value={formatMoney(billing.data?.overdue ?? 0, org.currency)}
                hint={billing.data ? `${plural(billing.data.overdue_invoices, "invoice")} past due` : undefined}
                loading={billing.isPending}
              />
            </>
          )}
          {can("payments.view") && (
            <Stat
              icon={Banknote}
              label="Collected this month"
              value={formatMoney(payments.data?.collected_this_month ?? 0, org.currency)}
              hint={
                payments.data?.unmatched_count
                  ? `${plural(payments.data.unmatched_count, "payment")} to reconcile`
                  : undefined
              }
              loading={payments.isPending}
              href="/dashboard/payments"
            />
          )}
          {can("deposits.view") && (
            <Stat
              icon={ShieldCheck}
              label="Deposits held"
              value={formatMoney(deposits.data?.held ?? 0, org.currency)}
              hint="Owed back to tenants; not income"
              loading={deposits.isPending}
            />
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {canTeam && (
          <StatCard
            icon={Users}
            label="Active team members"
            value={members.data?.count}
            loading={members.isPending}
            href="/dashboard/team"
          />
        )}
        {canTeam && (
          <StatCard
            icon={MailPlus}
            label="Pending invitations"
            value={invitations.data?.count}
            loading={invitations.isPending}
            href="/dashboard/team?tab=invitations"
          />
        )}
        {can("leases.view") && (
          <Card className="sm:col-span-2 xl:col-span-1">
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">Leases ending soon</CardTitle>
                <CardDescription>Fixed-term leases ending in 60 days</CardDescription>
              </div>
              <CalendarClock className="size-4 text-muted-foreground" aria-hidden />
            </CardHeader>
            <CardContent>
              {expiring.isPending ? (
                <Skeleton className="h-16 w-full" />
              ) : expiring.isError ? (
                <ErrorState message={errorMessage(expiring.error)} />
              ) : expiring.data.results.length === 0 ? (
                <p className="text-sm text-muted-foreground">None. You&apos;re all set.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {expiring.data.results.map((l) => (
                    <li key={l.id} className="flex justify-between gap-2">
                      <Link className="truncate hover:underline" href={`/dashboard/leases/${l.id}`}>
                        {l.tenant_name} · {l.unit_number}
                      </Link>
                      <span className="shrink-0 text-muted-foreground">{formatDay(l.end_date)}</span>
                    </li>
                  ))}
                  {expiring.data.count > expiring.data.results.length && (
                    <li>
                      <Link className="text-primary hover:underline" href="/dashboard/leases?view=expiring">
                        +{expiring.data.count - expiring.data.results.length} more
                      </Link>
                    </li>
                  )}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {canAudit && (
        <Card className="mt-6">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Recent activity</CardTitle>
              <CardDescription>Latest audited changes in this organization.</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/dashboard/audit">
                View all <ArrowRight />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {audit.isPending ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }, (_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : audit.isError ? (
              <ErrorState message={errorMessage(audit.error)} onRetry={() => audit.refetch()} />
            ) : audit.data.results.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity yet.</p>
            ) : (
              <ul className="divide-y">
                {audit.data.results.map((entry) => (
                  <li key={entry.id} className="flex items-start gap-3 py-3">
                    <ScrollText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">{describeAction(entry)}</p>
                      <p className="text-xs text-muted-foreground">
                        {entry.actor_email || "System"} · {formatDateTime(entry.created_at, org.timezone)}
                      </p>
                    </div>
                    <Badge variant="muted" className="hidden sm:inline-flex">
                      {entry.action}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  loading,
  href,
}: {
  icon: typeof Users;
  label: string;
  value: number | undefined;
  loading: boolean;
  href: string;
}) {
  return (
    <Link href={href} className="group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Card className="h-full transition-shadow group-hover:shadow-md">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardDescription>{label}</CardDescription>
            <Icon className="size-4 text-muted-foreground" aria-hidden />
          </div>
          {loading ? (
            <Skeleton className="h-8 w-16" />
          ) : (
            <p className="text-3xl font-semibold tracking-tight">{value ?? "—"}</p>
          )}
        </CardHeader>
      </Card>
    </Link>
  );
}
