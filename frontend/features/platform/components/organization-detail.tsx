"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Eye, FilePlus2, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input, NativeSelect } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  useEndSupport,
  useIssueInvoice,
  useOrganizationStatus,
  usePlatformOrganization,
  usePlatformPlans,
  useStartSupport,
  useUpdatePlatformSubscription,
} from "@/features/platform/api";
import { INVOICE_STATUS, InvoiceActions } from "@/features/platform/components/invoice-actions";
import { SUBSCRIPTION_STATUS } from "@/features/subscription/components/subscription-page";
import { errorMessage } from "@/lib/api/errors";
import { setActiveOrganizationId } from "@/lib/api/organization-store";
import { formatDateTime, formatDay, formatMoney } from "@/lib/utils";
import type { PlatformOrganizationDetail } from "@/types/api";

export function PlatformOrganizationDetail() {
  const { id } = useParams<{ id: string }>();
  const org = usePlatformOrganization(id);
  if (org.isPending) return <Skeleton className="h-96 w-full" />;
  if (org.isError) return <ErrorState message={errorMessage(org.error)} onRetry={() => org.refetch()} />;
  const o = org.data;
  const status = o.subscription_status ? SUBSCRIPTION_STATUS[o.subscription_status] : null;
  return (
    <>
      <Link href="/platform" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Organizations
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
            {o.name}
            {o.status === "suspended" && <Badge variant="destructive">Suspended</Badge>}
            {status && <Badge variant={status.variant}>{status.label}</Badge>}
          </h1>
          <p className="text-sm text-muted-foreground">
            Account {o.account_code ?? "—"} · {o.units} units · {o.members} members · joined {formatDay(o.created_at.slice(0, 10))}
          </p>
        </div>
        <SuspendButton org={o} />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Re-keyed on the saved values so the form resets after any change. */}
          <SubscriptionForm key={[o.plan_code, o.trial_ends_on, o.paid_until, o.complimentary, o.notes].join("|")} org={o} />
          <Invoices org={o} />
          <Support org={o} />
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Contact</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p>{o.email || "No email"}{o.phone && <> · {o.phone}</>}</p>
              <div>
                <p className="font-medium">Owners</p>
                {o.owners.length ? o.owners.map((u) => <p key={u.email} className="text-muted-foreground">{u.name} · {u.email}</p>) : <p className="text-muted-foreground">None</p>}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Recent activity</CardTitle></CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {o.recent_activity.map((a, i) => (
                  <li key={i}>
                    <span className="font-mono text-xs">{a.action}</span>
                    <p className="text-xs text-muted-foreground">{a.actor || "system"} · {formatDateTime(a.created_at)}</p>
                  </li>
                ))}
                {!o.recent_activity.length && <li className="text-muted-foreground">Nothing yet.</li>}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function SubscriptionForm({ org }: { org: PlatformOrganizationDetail }) {
  const plans = usePlatformPlans();
  const update = useUpdatePlatformSubscription(org.id);
  const initial = React.useMemo(() => ({
    plan: org.plan_code ?? "",
    trial_ends_on: org.trial_ends_on ?? "",
    paid_until: org.paid_until ?? "",
    complimentary: org.complimentary,
    notes: org.notes,
  }), [org]);
  const [form, setForm] = React.useState(initial);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    update.mutate(
      {
        ...(form.plan !== initial.plan && { plan: form.plan }),
        ...(form.trial_ends_on !== initial.trial_ends_on && { trial_ends_on: form.trial_ends_on || null }),
        ...(form.paid_until !== initial.paid_until && { paid_until: form.paid_until || null }),
        ...(form.complimentary !== initial.complimentary && { complimentary: form.complimentary }),
        ...(form.notes !== initial.notes && { notes: form.notes }),
      },
      { onSuccess: () => toast.success("Subscription updated"), onError: (err) => toast.error(errorMessage(err)) },
    );
  };
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Subscription</CardTitle>
        <CardDescription>Moving a date forward lifts &ldquo;overdue&rdquo; and read-only at once. Every change is audited.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField id="sub-plan" label="Plan">
              <NativeSelect value={form.plan} onChange={(e) => set("plan", e.target.value)}>
                {(plans.data ?? []).map((p) => <option key={p.id} value={p.code}>{p.name}{p.max_units ? ` (${p.max_units} units)` : ""}</option>)}
              </NativeSelect>
            </FormField>
            <FormField id="sub-trial" label="Trial ends">
              <Input type="date" value={form.trial_ends_on} onChange={(e) => set("trial_ends_on", e.target.value)} />
            </FormField>
            <FormField id="sub-paid" label="Paid until">
              <Input type="date" value={form.paid_until} onChange={(e) => set("paid_until", e.target.value)} />
            </FormField>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={form.complimentary} onChange={(e) => set("complimentary", e.target.checked)} />
            Complimentary: never invoiced and never read-only
          </label>
          <FormField id="sub-notes" label="Internal notes">
            <Textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </FormField>
          <div><Button type="submit" disabled={!dirty} loading={update.isPending}>Save subscription</Button></div>
        </form>
      </CardContent>
    </Card>
  );
}

function Invoices({ org }: { org: PlatformOrganizationDetail }) {
  const issue = useIssueInvoice(org.id);
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>Invoices</CardTitle>
          <CardDescription>Issued automatically a week before access ends. Issue one now to bill early.</CardDescription>
        </div>
        <Button size="sm" variant="outline" loading={issue.isPending}
          onClick={() => issue.mutate(undefined, { onSuccess: (i) => toast.success(`${i.number} issued`), onError: (e) => toast.error(errorMessage(e)) })}>
          <FilePlus2 /> Issue invoice
        </Button>
      </CardHeader>
      <CardContent className="px-0">
        {org.invoices.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {org.invoices.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>{i.number}<p className="text-xs text-muted-foreground">{i.plan_name} · {formatDay(i.period_start)} – {formatDay(i.period_end)}</p></TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(i.amount, i.currency)}</TableCell>
                  <TableCell>
                    <Badge variant={INVOICE_STATUS[i.status].variant}>{INVOICE_STATUS[i.status].label}</Badge>
                    {i.payment_reference && <p className="text-xs text-muted-foreground">{i.payment_method} · {i.payment_reference}</p>}
                  </TableCell>
                  <TableCell><InvoiceActions invoice={i} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="px-6 text-sm text-muted-foreground">No invoices yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

function Support({ org }: { org: PlatformOrganizationDetail }) {
  const start = useStartSupport(org.id);
  const end = useEndSupport();
  const router = useRouter();
  const qc = useQueryClient();
  const [reason, setReason] = React.useState("");
  const [minutes, setMinutes] = React.useState("30");
  const mine = org.support_grants.find((g) => g.active && g.mine);

  const openDashboard = () => {
    setActiveOrganizationId(org.id);
    qc.removeQueries({ queryKey: ["org"] });
    router.push("/dashboard");
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ShieldAlert className="size-5" /> Support access</CardTitle>
        <CardDescription>
          See the organization&rsquo;s dashboard exactly as an owner would, read-only and for a limited time. The owners are notified and every page you open is logged.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {mine ? (
          <Alert variant="info" title={`Your support session ends at ${formatDateTime(mine.expires_at)}`}>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" onClick={openDashboard}><Eye /> Open their dashboard</Button>
              <Button size="sm" variant="outline" loading={end.isPending}
                onClick={() => end.mutate(mine.id, { onSuccess: () => toast.success("Support session ended"), onError: (e) => toast.error(errorMessage(e)) })}>
                End session
              </Button>
            </div>
          </Alert>
        ) : org.status === "suspended" ? (
          <p className="text-sm text-muted-foreground">Reactivate the organization before starting a support session.</p>
        ) : (
          <form
            className="grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              start.mutate({ reason: reason.trim(), minutes: Number(minutes) }, {
                onSuccess: () => { setReason(""); toast.success("Support session started"); },
                onError: (err) => toast.error(errorMessage(err)),
              });
            }}
          >
            <FormField id="support-reason" label="Reason (shown to the owners)">
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ticket #123: rent invoices look wrong" required maxLength={255} />
            </FormField>
            <FormField id="support-minutes" label="For">
              <NativeSelect value={minutes} onChange={(e) => setMinutes(e.target.value)}>
                {[15, 30, 60, 120, 240].map((m) => <option key={m} value={m}>{m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? "s" : ""}`}</option>)}
              </NativeSelect>
            </FormField>
            <Button type="submit" disabled={!reason.trim()} loading={start.isPending}>Start support session</Button>
          </form>
        )}
        {org.support_grants.length > 0 && (
          <ul className="divide-y rounded-lg border text-sm">
            {org.support_grants.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <div>
                  <p>{g.reason}</p>
                  <p className="text-xs text-muted-foreground">{g.user} · {formatDateTime(g.created_at)}</p>
                </div>
                {g.active ? <Badge variant="warning">Active until {formatDateTime(g.expires_at)}</Badge> : <Badge variant="muted">Ended</Badge>}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function SuspendButton({ org }: { org: PlatformOrganizationDetail }) {
  const change = useOrganizationStatus(org.id);
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  if (org.status === "suspended") {
    return (
      <Button variant="outline" loading={change.isPending}
        onClick={() => change.mutate({ action: "reactivate" }, { onSuccess: () => toast.success("Organization reactivated"), onError: (e) => toast.error(errorMessage(e)) })}>
        Reactivate
      </Button>
    );
  }
  return (
    <>
      <Button variant="outline" className="text-destructive" onClick={() => setOpen(true)}>Suspend</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form className="grid gap-4" onSubmit={(e) => {
            e.preventDefault();
            change.mutate({ action: "suspend", reason: reason.trim() }, {
              onSuccess: () => { toast.success("Organization suspended"); setOpen(false); },
              onError: (err) => toast.error(errorMessage(err)),
            });
          }}>
            <DialogHeader>
              <DialogTitle>Suspend {org.name}?</DialogTitle>
              <DialogDescription>Nobody in the organization can use Nexora until it&rsquo;s reactivated. Tenants&rsquo; data is kept. Use this for fraud or abuse, not unpaid bills: those go read-only on their own.</DialogDescription>
            </DialogHeader>
            <FormField id="suspend-reason" label="Reason">
              <Input value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={255} />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" variant="destructive" loading={change.isPending}>Suspend</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
