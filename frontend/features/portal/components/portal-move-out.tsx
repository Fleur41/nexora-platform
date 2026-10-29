"use client";

import { CheckCircle2, Circle, DoorOpen } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormField } from "@/components/ui/form-field";
import { Input, NativeSelect } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Textarea } from "@/components/ui/textarea";
import { useGivePortalNotice, usePortalMoveOuts, usePortalSummary, useWithdrawPortalNotice } from "@/features/portal/api";
import { useTenancy } from "@/features/portal/tenancy";
import { errorMessage } from "@/lib/api/errors";
import { MOVE_OUT_STATUS } from "@/lib/labels";
import { cn, formatDay, todayIn } from "@/lib/utils";
import type { PortalMoveOut } from "@/types/api";

const OPEN = ["submitted", "acknowledged", "inspection_scheduled"];

export function PortalMoveOutPage() {
  const { tenantId } = useTenancy();
  const notices = usePortalMoveOuts(tenantId);
  const summary = usePortalSummary(tenantId);

  if (notices.isPending || summary.isPending) return <Skeleton className="h-96 w-full" />;
  if (notices.isError) return <ErrorState message={errorMessage(notices.error)} onRetry={() => notices.refetch()} />;
  if (summary.isError) return <ErrorState message={errorMessage(summary.error)} onRetry={() => summary.refetch()} />;
  const open = notices.data.filter((n) => OPEN.includes(n.status));
  const leasesWithNotice = new Set(open.map((n) => n.lease));
  const canGive = summary.data.leases.filter((l) => l.status === "active" && !leasesWithNotice.has(l.id));
  const past = notices.data.filter((n) => !OPEN.includes(n.status));

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold tracking-tight">Moving out</h1>
      {open.map((n) => <OpenNotice key={n.id} notice={n} />)}
      {canGive.length > 0 ? (
        <GiveNotice leases={canGive.map((l) => ({ id: l.id, label: `${l.property_name} unit ${l.unit_number}` }))} />
      ) : (
        open.length === 0 && <EmptyState icon={DoorOpen} title="No active lease" description="You can give notice on a home you currently rent." />
      )}
      {past.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Earlier notices</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {past.map((n) => (
                <li key={n.id} className="flex items-center justify-between gap-3 py-2">
                  <span>{n.lease_reference} · {formatDay(n.intended_date)}</span>
                  <Badge variant={MOVE_OUT_STATUS[n.status].variant}>{n.status === "completed" ? "Moved out" : "Withdrawn"}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function OpenNotice({ notice: n }: { notice: PortalMoveOut }) {
  const { tenantId } = useTenancy();
  const withdraw = useWithdrawPortalNotice(tenantId);
  const [confirming, setConfirming] = React.useState(false);
  const steps = [
    { label: "Notice sent", done: true, detail: `Moving out ${formatDay(n.intended_date)}` },
    { label: "Landlord acknowledged", done: n.status !== "submitted", detail: n.acknowledged_at ? formatDay(n.acknowledged_at.slice(0, 10)) : "Waiting for your landlord" },
    { label: "Move-out inspection", done: n.status === "inspection_scheduled", detail: n.inspection_date ? `On ${formatDay(n.inspection_date)}. Be there if you can; you can sign the checklist.` : "Your landlord will schedule it" },
    { label: "Final settlement", done: false, detail: "Your deposit is settled after the inspection: damages, any unpaid rent, then the refund." },
  ];
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          Notice for {n.lease_reference}
          <Badge variant={MOVE_OUT_STATUS[n.status].variant}>{MOVE_OUT_STATUS[n.status].label}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ol className="space-y-3">
          {steps.map((s) => (
            <li key={s.label} className="flex gap-3 text-sm">
              {s.done ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-accent-strong" aria-label="Done" /> : <Circle className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-label="Not yet" />}
              <span>
                <span className={cn("block font-medium", !s.done && "text-muted-foreground")}>{s.label}</span>
                <span className="block text-muted-foreground">{s.detail}</span>
              </span>
            </li>
          ))}
        </ol>
        {n.message && <p className="whitespace-pre-line rounded-lg bg-muted/60 p-3 text-sm">{n.message}</p>}
        {n.status === "submitted" ? (
          <Button variant="outline" onClick={() => setConfirming(true)}>Withdraw notice</Button>
        ) : (
          <p className="text-xs text-muted-foreground">Changed your mind? Contact your landlord: an acknowledged notice can only be withdrawn by them.</p>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Withdraw your notice?"
        description="Your tenancy continues as before."
        confirmLabel="Withdraw notice"
        loading={withdraw.isPending}
        // mutateAsync: this card unmounts once the notice is withdrawn, which would drop mutate()'s callbacks.
        onConfirm={() => withdraw.mutateAsync(n.id).then(
          () => toast.success("Notice withdrawn"),
          (e) => { setConfirming(false); toast.error(errorMessage(e)); },
        )}
      />
    </Card>
  );
}

function GiveNotice({ leases }: { leases: { id: string; label: string }[] }) {
  const { tenantId, timeZone } = useTenancy();
  const give = useGivePortalNotice(tenantId);
  const today = todayIn(timeZone);
  const [lease, setLease] = React.useState(leases[0]!.id);
  const [date, setDate] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [confirming, setConfirming] = React.useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Give notice to move out</CardTitle>
        <CardDescription>
          Check your lease for the notice period. Only your landlord sees your notice; your home isn&apos;t advertised until they acknowledge it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {give.isError && <Alert variant="error" title={give.error.message} />}
        {leases.length > 1 && (
          <FormField id="n-lease" label="Home">
            <NativeSelect value={lease} onChange={(e) => setLease(e.target.value)}>
              {leases.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </NativeSelect>
          </FormField>
        )}
        <FormField id="n-date" label="Date you plan to move out">
          <Input type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} />
        </FormField>
        <FormField id="n-msg" label="Message (optional)" hint="e.g. a forwarding address or the best time for the inspection.">
          <Textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
        </FormField>
        <Button disabled={!date || date < today} onClick={() => setConfirming(true)}>Send notice</Button>
      </CardContent>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Send your move-out notice?"
        description={`You're telling your landlord you'll move out on ${date ? formatDay(date) : ""}. You can withdraw it until they acknowledge it.`}
        confirmLabel="Send notice"
        loading={give.isPending}
        // mutateAsync: this form unmounts once the lease has an open notice.
        onConfirm={() => give.mutateAsync({ lease, intended_date: date, message }).then(
          () => toast.success("Notice sent to your landlord"),
          () => setConfirming(false),
        )}
      />
    </Card>
  );
}
