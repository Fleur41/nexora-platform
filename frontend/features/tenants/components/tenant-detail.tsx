"use client";

import { Archive, ArrowLeft, FilePlus2, Mail, Pencil, Phone, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { useOrganization } from "@/components/providers/organization-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { LeaseStatusBadge } from "@/components/ui/status";
import { DocumentsPanel } from "@/features/documents/components/documents-panel";
import { useLeases } from "@/features/leases/api";
import { useTenant, useTenantStatus } from "@/features/tenants/api";
import { ApiError, errorMessage } from "@/lib/api/errors";
import { ID_TYPE } from "@/lib/labels";
import { formatDay, formatMoney } from "@/lib/utils";

import { TenantFormDialog } from "./tenant-form-dialog";

export function TenantDetail() {
  const { id } = useParams<{ id: string }>();
  const { can, current } = useOrganization();
  const tenant = useTenant(id);
  const leases = useLeases({ tenant: id, page_size: 100 }, can("leases.view"));
  const status = useTenantStatus();
  const [editing, setEditing] = React.useState(false);
  const [archiving, setArchiving] = React.useState(false);
  const canManage = can("tenants.manage");

  if (tenant.isPending) return <Skeleton className="h-96 w-full" />;
  if (tenant.isError) {
    return (
      <ErrorState
        message={
          tenant.error instanceof ApiError && tenant.error.status === 404
            ? "This tenant doesn't exist or you don't have access to them."
            : errorMessage(tenant.error)
        }
      />
    );
  }
  const t = tenant.data;

  return (
    <>
      <Link href="/dashboard/tenants" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Tenants
      </Link>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{t.full_name}</h1>
            {t.status === "archived" && <Badge variant="muted">Archived</Badge>}
          </div>
          <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <a href={`tel:${t.phone}`} className="inline-flex items-center gap-1 hover:text-foreground">
              <Phone className="size-3.5" /> {t.phone}
            </a>
            {t.email && (
              <a href={`mailto:${t.email}`} className="inline-flex items-center gap-1 hover:text-foreground">
                <Mail className="size-3.5" /> {t.email}
              </a>
            )}
          </p>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            {can("leases.manage") && t.status === "active" && (
              <Button asChild>
                <Link href={`/dashboard/leases/new?tenant=${t.id}`}>
                  <FilePlus2 /> New lease
                </Link>
              </Button>
            )}
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil /> Edit
            </Button>
            {t.status === "active" ? (
              <Button variant="outline" onClick={() => setArchiving(true)} disabled={t.active_lease_count > 0} title={t.active_lease_count > 0 ? "End the active lease first" : undefined}>
                <Archive /> Archive
              </Button>
            ) : (
              <Button
                variant="outline"
                loading={status.isPending}
                onClick={() =>
                  status.mutate(
                    { id: t.id, action: "restore" },
                    { onSuccess: () => toast.success("Tenant restored"), onError: (e) => toast.error(errorMessage(e)) },
                  )
                }
              >
                <RotateCcw /> Restore
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {can("leases.view") && (
            <Card>
              <CardHeader>
                <CardTitle>Leases</CardTitle>
              </CardHeader>
              <CardContent>
                {leases.isPending ? (
                  <Skeleton className="h-24 w-full" />
                ) : leases.isError ? (
                  <ErrorState message={errorMessage(leases.error)} />
                ) : leases.data.results.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No leases yet.</p>
                ) : (
                  <ul className="divide-y">
                    {leases.data.results.map((l) => (
                      <li key={l.id}>
                        <Link href={`/dashboard/leases/${l.id}`} className="flex items-center justify-between gap-3 py-3 hover:bg-muted/40">
                          <div className="min-w-0">
                            <p className="font-medium">
                              {l.property_name} · Unit {l.unit_number}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {l.reference} · {formatDay(l.start_date)} – {formatDay(l.ended_on ?? l.end_date)}
                              {l.current_rent && ` · ${formatMoney(l.current_rent, current.organization.currency)}/month`}
                            </p>
                          </div>
                          <LeaseStatusBadge status={l.status} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}
          {canManage && (
            <Card>
              <CardHeader>
                <CardTitle>Documents</CardTitle>
              </CardHeader>
              <CardContent>
                <DocumentsPanel target="tenant" targetId={t.id} canManage categories={["identity", "other"]} />
              </CardContent>
            </Card>
          )}
        </div>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3 text-sm">
              <Detail label="Alternate phone" value={t.alternate_phone} />
              {canManage && (
                <>
                  <Detail label={t.id_type ? ID_TYPE[t.id_type] : "ID"} value={t.id_number} />
                  <Detail label="KRA PIN" value={t.kra_pin} />
                  <Detail label="Occupation" value={t.occupation} />
                  <Detail label="Employer" value={t.employer} />
                </>
              )}
              <Detail
                label="Emergency contact"
                value={[t.emergency_contact_name, t.emergency_contact_phone].filter(Boolean).join(" · ")}
              />
              {canManage && t.notes && <Detail label="Private notes" value={t.notes} />}
            </dl>
          </CardContent>
        </Card>
      </div>

      <TenantFormDialog open={editing} onOpenChange={setEditing} tenant={t} />
      <ConfirmDialog
        open={archiving}
        onOpenChange={setArchiving}
        title="Archive tenant?"
        description="They'll be hidden from the tenant list. Their leases and history stay available, and you can restore them at any time."
        confirmLabel="Archive"
        loading={status.isPending}
        onConfirm={() =>
          status.mutate(
            { id: t.id, action: "archive" },
            {
              onSuccess: () => {
                toast.success("Tenant archived");
                setArchiving(false);
              },
              onError: (e) => {
                toast.error(errorMessage(e));
                setArchiving(false);
              },
            },
          )
        }
      />
    </>
  );
}

function Detail({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="whitespace-pre-line">{value || "—"}</dd>
    </div>
  );
}
