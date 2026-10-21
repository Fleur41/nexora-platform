"use client";

import { ArrowRight, Building2, MailPlus, ScrollText, Users } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import { useOrganization } from "@/components/providers/organization-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { useAuditLogs } from "@/features/audit/api";
import { describeAction } from "@/features/audit/describe";
import { useInvitations, useMembers } from "@/features/team/api";
import { errorMessage } from "@/lib/api/errors";
import { ROLE_LABELS } from "@/lib/roles";
import { formatDateTime } from "@/lib/utils";

export default function DashboardHome() {
  const { current, can } = useOrganization();
  const org = current.organization;
  const canTeam = can("members.view");
  const canAudit = can("audit.view");
  const members = useMembers({}, canTeam);
  const invitations = useInvitations({ status: "pending" }, canTeam);
  const audit = useAuditLogs({ page_size: 6 }, canAudit);

  return (
    <>
      <PageHeader
        title={org.name}
        description={`You are signed in as ${ROLE_LABELS[current.role]}. Currency ${org.currency} · ${org.timezone.replace("_", " ")}`}
      />

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
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardDescription>Property management</CardDescription>
              <Building2 className="size-4 text-muted-foreground" aria-hidden />
            </div>
            <CardTitle className="text-base">Coming in the next release</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Properties, units, tenants and leases arrive in Phase 2. Your team and permissions
            are ready for them.
          </CardContent>
        </Card>
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
