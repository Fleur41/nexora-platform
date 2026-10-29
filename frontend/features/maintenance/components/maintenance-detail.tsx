"use client";

import { ArrowLeft, Check, Lock, X } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { useOrganization } from "@/components/providers/organization-provider";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input, NativeSelect } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { Textarea } from "@/components/ui/textarea";
import { DocumentsPanel } from "@/features/documents/components/documents-panel";
import { useMaintenance, useMaintenanceAction } from "@/features/maintenance/api";
import { useMembers } from "@/features/team/api";
import { ApiError, errorMessage } from "@/lib/api/errors";
import { MAINTENANCE_CATEGORY, MAINTENANCE_NEXT, MAINTENANCE_STATUS, URGENCY } from "@/lib/labels";
import { formatDateTime, formatDay, formatMoney } from "@/lib/utils";
import type { MaintenanceDetail as Detail, MaintenanceStatus } from "@/types/api";

export function MaintenanceDetail() {
  const { id } = useParams<{ id: string }>();
  const { can, current } = useOrganization();
  const req = useMaintenance(id);
  const action = useMaintenanceAction();
  const [note, setNote] = React.useState("");
  const [internal, setInternal] = React.useState(false);
  const tz = current.organization.timezone;

  if (req.isPending) return <Skeleton className="h-96 w-full" />;
  if (req.isError) {
    return <ErrorState message={req.error instanceof ApiError && req.error.status === 404 ? "This request doesn't exist or you don't have access to it." : errorMessage(req.error)} />;
  }
  const r = req.data;
  const canManage = can("maintenance.manage");
  const run = (path: string, body: object, done: string) =>
    action.mutate({ id: r.id, path, body }, { onSuccess: () => toast.success(done), onError: (e) => toast.error(errorMessage(e)) });

  return (
    <>
      <Link href="/dashboard/maintenance" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Maintenance
      </Link>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{r.title}</h1>
            <Badge variant={MAINTENANCE_STATUS[r.status].variant}>{MAINTENANCE_STATUS[r.status].label}</Badge>
            <Badge variant={URGENCY[r.urgency].variant}>{URGENCY[r.urgency].label}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {r.reference} · {MAINTENANCE_CATEGORY[r.category]} · {r.property_name} unit {r.unit_number}
            {r.tenant && <> · <Link className="hover:underline" href={`/dashboard/tenants/${r.tenant}`}>{r.tenant_name}</Link></>}
          </p>
        </div>
        {canManage && MAINTENANCE_NEXT[r.status].length > 0 && (
          <div className="flex flex-wrap gap-2">
            {MAINTENANCE_NEXT[r.status].map((s: MaintenanceStatus) => (
              <Button key={s} size="sm" variant={s === "resolved" ? "default" : "outline"} disabled={action.isPending}
                onClick={() => run("status", { status: s, note: note.trim() && !internal ? note : "" }, `Marked ${MAINTENANCE_STATUS[s].label.toLowerCase()}`)}>
                {s === "cancelled" ? <X /> : s === "resolved" ? <Check /> : null}
                {s === "acknowledged" ? "Acknowledge" : s === "in_progress" ? "Start work" : s === "on_hold" ? "Put on hold" : s === "resolved" ? "Mark resolved" : s === "closed" ? "Close" : "Cancel"}
              </Button>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardContent><p className="whitespace-pre-line text-sm">{r.description}</p></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Updates</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {r.updates.length === 0 && <p className="text-sm text-muted-foreground">No updates yet.</p>}
              <ol className="space-y-3">
                {r.updates.map((u) => (
                  <li key={u.id} className={`rounded-lg border p-3 text-sm ${u.is_internal ? "border-warning/40 bg-warning/5" : u.from_tenant ? "bg-muted/50" : ""}`}>
                    <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{u.author_name}{u.from_tenant && " (tenant)"}</span>
                      {formatDateTime(u.created_at, tz)}
                      {u.is_internal && <Badge variant="warning"><Lock className="mr-1 size-3" />Internal</Badge>}
                      {u.status_to && <Badge variant="outline">→ {MAINTENANCE_STATUS[u.status_to as MaintenanceStatus]?.label ?? u.status_to}</Badge>}
                    </p>
                    {u.body && <p className="mt-1 whitespace-pre-line">{u.body}</p>}
                  </li>
                ))}
              </ol>
              {canManage && r.status !== "closed" && r.status !== "cancelled" && (
                <div className="space-y-2 border-t pt-4">
                  <Textarea rows={2} aria-label="Add an update" placeholder={internal ? "Internal note (staff only)…" : "Update the tenant can see…"} value={note} onChange={(e) => setNote(e.target.value)} />
                  <div className="flex items-center justify-between gap-3">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
                      Internal note (never shown to the tenant)
                    </label>
                    <Button size="sm" disabled={!note.trim()} loading={action.isPending}
                      onClick={() => action.mutate({ id: r.id, path: "notes", body: { body: note, internal } }, {
                        onSuccess: () => { setNote(""); toast.success(internal ? "Internal note added" : "Update sent to the tenant"); },
                        onError: (e) => toast.error(errorMessage(e)),
                      })}>
                      Add update
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Photos &amp; files</CardTitle></CardHeader>
            <CardContent>
              <DocumentsPanel target="maintenance_request" targetId={r.id} canManage={canManage} categories={["photo", "other"]} gallery />
            </CardContent>
          </Card>
        </div>
        <div className="space-y-6">
          <AssignCard request={r} />
          {r.costs !== null && <CostsCard request={r} />}
        </div>
      </div>
    </>
  );
}

function AssignCard({ request: r }: { request: Detail }) {
  const { can, current } = useOrganization();
  const members = useMembers({}, can("maintenance.manage") && can("members.view"));
  const action = useMaintenanceAction();
  const [member, setMember] = React.useState(r.assigned_to ?? "");
  const [date, setDate] = React.useState(r.scheduled_for ?? "");
  return (
    <Card>
      <CardHeader><CardTitle>Assignment</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>
          {r.assigned_to_name ? <>Assigned to <strong>{r.assigned_to_name}</strong></> : "Not assigned"}
          {r.scheduled_for && <> · visit {formatDay(r.scheduled_for)}</>}
        </p>
        {can("maintenance.manage") && r.status !== "closed" && r.status !== "cancelled" && (
          <>
            {members.data ? (
              <FormField id="as-member" label="Assign to">
                <NativeSelect value={member} onChange={(e) => setMember(e.target.value)}>
                  <option value="">Nobody</option>
                  {members.data.results.map((m) => <option key={m.id} value={m.id}>{m.user.full_name}</option>)}
                </NativeSelect>
              </FormField>
            ) : (
              <p className="text-xs text-muted-foreground">You can assign it to yourself.</p>
            )}
            <FormField id="as-date" label="Visit date (optional)">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </FormField>
            <Button size="sm" variant="outline" loading={action.isPending}
              onClick={() => action.mutate(
                { id: r.id, path: "assign", body: { membership: (member || (members.data ? null : current.membership_id)) || null, scheduled_for: date || null } },
                { onSuccess: () => toast.success("Assignment saved"), onError: (e) => toast.error(errorMessage(e)) },
              )}>
              Save assignment
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function CostsCard({ request: r }: { request: Detail }) {
  const { current, can } = useOrganization();
  const action = useMaintenanceAction();
  const [form, setForm] = React.useState({ kind: "quotation", description: "", amount: "", supplier_name: "" });
  const currency = current.organization.currency;
  const approved = (r.costs ?? []).filter((c) => c.status === "approved" || c.status === "recorded").reduce((s, c) => s + Number(c.amount), 0);
  return (
    <Card>
      <CardHeader><CardTitle>Quotes &amp; costs</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        {(r.costs ?? []).length === 0 ? <p className="text-muted-foreground">None recorded.</p> : (
          <ul className="divide-y">
            {r.costs!.map((c) => (
              <li key={c.id} className="py-2">
                <div className="flex justify-between gap-2">
                  <span>{c.description}{c.supplier_name && <span className="block text-xs text-muted-foreground">{c.supplier_name}</span>}</span>
                  <span className="text-right">{formatMoney(c.amount, currency)}<span className="block text-xs text-muted-foreground">{c.kind === "quotation" ? `Quote · ${c.status}` : "Cost"}</span></span>
                </div>
                {c.status === "pending" && can("maintenance.manage") && (
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => action.mutate({ id: r.id, path: `costs/${c.id}/decide`, body: { approve: true } }, { onSuccess: () => toast.success("Quote approved") })}>Approve</Button>
                    <Button size="sm" variant="ghost" onClick={() => action.mutate({ id: r.id, path: `costs/${c.id}/decide`, body: { approve: false } }, { onSuccess: () => toast.success("Quote rejected") })}>Reject</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="font-medium">Approved / incurred: {formatMoney(approved, currency)}</p>
        <div className="space-y-2 border-t pt-3">
          {action.isError && <Alert variant="error" title={action.error.message} />}
          <div className="grid grid-cols-2 gap-2">
            <NativeSelect aria-label="Cost type" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="quotation">Quotation</option>
              <option value="expense">Cost incurred</option>
            </NativeSelect>
            <Input aria-label="Amount" inputMode="decimal" placeholder="Amount" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </div>
          <Input aria-label="Cost description" placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <Input aria-label="Supplier" placeholder="Supplier (optional)" value={form.supplier_name} onChange={(e) => setForm({ ...form, supplier_name: e.target.value })} />
          <Button size="sm" variant="outline" disabled={!form.description.trim() || !(Number(form.amount) > 0)} loading={action.isPending}
            onClick={() => action.mutate({ id: r.id, path: "costs", body: form }, { onSuccess: () => { setForm({ kind: "quotation", description: "", amount: "", supplier_name: "" }); toast.success("Saved"); } })}>
            Add
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
