"use client";

import { ArrowLeft, Check, ClipboardCheck, Undo2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { useOrganization } from "@/components/providers/organization-provider";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input, NativeSelect } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { Textarea } from "@/components/ui/textarea";
import { useMoveOut, useMoveOutAction, useSettlementPreview } from "@/features/moveouts/api";
import { useMembers } from "@/features/team/api";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { ApiError, errorMessage } from "@/lib/api/errors";
import { MOVE_OUT_STATUS, PAYMENT_METHOD, POST_LEASE_UNIT_STATUSES, UNIT_STATUS } from "@/lib/labels";
import { formatDateTime, formatDay, formatMoney, todayIn } from "@/lib/utils";
import type { MoveOutNotice, SettlementPreview, UnitStatus } from "@/types/api";

export function MoveOutDetail() {
  const { id } = useParams<{ id: string }>();
  const { can, current } = useOrganization();
  const notice = useMoveOut(id);
  const action = useMoveOutAction();
  const [dialog, setDialog] = React.useState<"acknowledge" | "schedule" | "withdraw" | null>(null);
  const [staffNotes, setStaffNotes] = React.useState("");

  if (notice.isPending) return <Skeleton className="h-96 w-full" />;
  if (notice.isError) {
    return <ErrorState message={notice.error instanceof ApiError && notice.error.status === 404 ? "This notice doesn't exist or you don't have access to it." : errorMessage(notice.error)} />;
  }
  const n = notice.data;
  const tz = current.organization.timezone;
  const isOpen = n.status !== "completed" && n.status !== "withdrawn";
  const canManage = can("moveouts.manage") && isOpen;
  const inspectionPending = n.inspection_status === "scheduled";
  const run = (act: "acknowledge" | "withdraw", body: object, done: string) =>
    action.mutate({ id: n.id, action: act, body }, {
      onSuccess: () => { setDialog(null); toast.success(done); },
      onError: (e) => toast.error(errorMessage(e)),
    });

  return (
    <>
      <Link href="/dashboard/move-outs" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Move-outs
      </Link>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{n.tenant_name}</h1>
            <Badge variant={MOVE_OUT_STATUS[n.status].variant}>{MOVE_OUT_STATUS[n.status].label}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {n.property_name} unit {n.unit_number} · <Link className="hover:underline" href={`/dashboard/leases/${n.lease}`}>{n.lease_reference}</Link> · moving out {formatDay(n.intended_date)}
          </p>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            {n.status === "submitted" && <Button size="sm" onClick={() => setDialog("acknowledge")}><Check /> Acknowledge</Button>}
            {n.status !== "submitted" && !inspectionPending && (
              <Button size="sm" variant="outline" onClick={() => setDialog("schedule")}><ClipboardCheck /> Schedule inspection</Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setDialog("withdraw")}><Undo2 /> Withdraw</Button>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {canManage && n.status !== "submitted" && <SettleCard notice={n} />}
          {n.status === "completed" && <SettlementRecord notice={n} />}
          {n.status === "submitted" && can("moveouts.manage") && (
            <Alert title="Acknowledge this notice to continue">
              Until it is acknowledged the notice stays private and the unit keeps its “occupied” status.
            </Alert>
          )}
        </div>
        <Card className="h-fit">
          <CardHeader><CardTitle>Notice</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>{n.from_tenant ? "Given by the tenant from the portal" : "Recorded by staff"} · {formatDateTime(n.created_at, tz)}</p>
            {n.acknowledged_at && <p>Acknowledged {formatDateTime(n.acknowledged_at, tz)}</p>}
            {n.message && <p className="whitespace-pre-line rounded-lg bg-muted/50 p-3">{n.message}</p>}
            {n.inspection && (
              <p>
                Inspection: <Link className="font-medium hover:underline" href={`/dashboard/inspections/${n.inspection}`}>{n.inspection_reference}</Link>
                {n.inspection_status && ` (${n.inspection_status})`}
              </p>
            )}
            {n.staff_notes && <p className="whitespace-pre-line border-t pt-2 text-muted-foreground">{n.staff_notes}</p>}
          </CardContent>
        </Card>
      </div>

      <Dialog open={dialog === "acknowledge"} onOpenChange={(o) => setDialog(o ? "acknowledge" : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Acknowledge notice</DialogTitle>
            <DialogDescription>The tenant is told their notice was received, and unit {n.unit_number} is marked “notice submitted”.</DialogDescription>
          </DialogHeader>
          <FormField id="ack-notes" label="Staff notes (optional)">
            <Textarea rows={3} value={staffNotes} onChange={(e) => setStaffNotes(e.target.value)} />
          </FormField>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
            <Button loading={action.isPending} onClick={() => run("acknowledge", { staff_notes: staffNotes }, "Notice acknowledged")}>Acknowledge</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ScheduleDialog notice={n} open={dialog === "schedule"} onOpenChange={(o) => setDialog(o ? "schedule" : null)} />
      <ConfirmDialog
        open={dialog === "withdraw"}
        onOpenChange={(o) => setDialog(o ? "withdraw" : null)}
        title="Withdraw this notice?"
        description="The tenancy continues as before and the unit goes back to occupied. A scheduled move-out inspection is cancelled."
        confirmLabel="Withdraw notice"
        destructive
        loading={action.isPending}
        onConfirm={() => run("withdraw", {}, "Notice withdrawn")}
      />
    </>
  );
}

function ScheduleDialog({ notice: n, open, onOpenChange }: { notice: MoveOutNotice; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { can } = useOrganization();
  const members = useMembers({}, open && can("members.view"));
  const action = useMoveOutAction();
  const [date, setDate] = React.useState(n.intended_date);
  const [inspector, setInspector] = React.useState("");
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) action.reset(); onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Schedule move-out inspection</DialogTitle>
          <DialogDescription>The tenant is notified of the date. Record damages on the inspection checklist; they flow into the settlement.</DialogDescription>
        </DialogHeader>
        {action.isError && <Alert variant="error" title={action.error.message} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="s-date" label="Date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </FormField>
          {members.data && (
            <FormField id="s-insp" label="Inspector (optional)">
              <NativeSelect value={inspector} onChange={(e) => setInspector(e.target.value)}>
                <option value="">Not assigned</option>
                {members.data.results.map((m) => <option key={m.id} value={m.id}>{m.user.full_name}</option>)}
              </NativeSelect>
            </FormField>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!date} loading={action.isPending}
            onClick={() => action.mutate({ id: n.id, action: "schedule-inspection", body: { scheduled_for: date, inspector: inspector || null } }, {
              onSuccess: () => { toast.success("Inspection scheduled"); onOpenChange(false); },
            })}>
            Schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SettleCard({ notice: n }: { notice: MoveOutNotice }) {
  const { can, current } = useOrganization();
  const action = useMoveOutAction();
  const today = todayIn(current.organization.timezone);
  const currency = current.organization.currency;
  const [movedOut, setMovedOut] = React.useState(n.intended_date < today ? n.intended_date : today);
  const [applyDeposit, setApplyDeposit] = React.useState(true);
  const [damages, setDamages] = React.useState("");
  const [unitStatus, setUnitStatus] = React.useState<UnitStatus>("available");
  const [refund, setRefund] = React.useState({ method: "", reference: "" });
  const [notes, setNotes] = React.useState("");
  const [confirming, setConfirming] = React.useState(false);
  // Memoized: the debounce re-arms whenever the value's identity changes.
  const input = React.useMemo(
    () => ({ moved_out_on: movedOut, apply_deposit_to_balance: applyDeposit, ...(damages.trim() ? { damages: damages.trim() } : {}) }),
    [movedOut, applyDeposit, damages],
  );
  const params = useDebouncedValue(input, 300);
  const preview = useSettlementPreview(n.id, params, Boolean(params.moved_out_on));
  const p = preview.data;
  const permitted = can("leases.manage") && can("deposits.settle");
  const ready = p && (Number(p.refund) === 0 || refund.method);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Settle and close</CardTitle>
        <CardDescription>
          Ends the lease, bills the final (prorated) period, deducts damages, applies the deposit to arrears and records the refund. This can&apos;t be undone.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {n.inspection_status === "scheduled" && (
          <Alert variant="info" title="The move-out inspection isn't complete">
            Damages from the checklist are only included once it is completed. You can also enter a damages amount below.
          </Alert>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField id="st-date" label="Moved out on" hint="Cannot be in the future.">
            <Input type="date" max={today} value={movedOut} onChange={(e) => setMovedOut(e.target.value)} />
          </FormField>
          <FormField id="st-damages" label="Damages override" hint="Leave blank to use the inspection.">
            <Input inputMode="decimal" placeholder={p ? p.damages_found : ""} value={damages} onChange={(e) => setDamages(e.target.value)} />
          </FormField>
          <FormField id="st-unit" label={`Unit ${n.unit_number} becomes`}>
            <NativeSelect value={unitStatus} onChange={(e) => setUnitStatus(e.target.value as UnitStatus)}>
              {POST_LEASE_UNIT_STATUSES.map((s) => <option key={s} value={s}>{UNIT_STATUS[s].label}</option>)}
            </NativeSelect>
          </FormField>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={applyDeposit} onChange={(e) => setApplyDeposit(e.target.checked)} />
          Use the remaining deposit to clear unpaid rent and charges
        </label>

        {preview.isError ? (
          <Alert variant="error" title={errorMessage(preview.error)} />
        ) : !p ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <SettlementTable preview={p} currency={currency} />
        )}

        {p && Number(p.refund) > 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="st-method" label="Refund paid by">
              <NativeSelect value={refund.method} onChange={(e) => setRefund({ ...refund, method: e.target.value })}>
                <option value="">Choose…</option>
                {Object.entries(PAYMENT_METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </NativeSelect>
            </FormField>
            <FormField id="st-ref" label="Refund reference (optional)">
              <Input maxLength={64} value={refund.reference} onChange={(e) => setRefund({ ...refund, reference: e.target.value })} />
            </FormField>
          </div>
        )}
        <FormField id="st-notes" label="Notes (optional)">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </FormField>
        {!permitted && <Alert variant="info" title="Completing a move-out also needs the lease management and deposit settlement permissions." />}
        <div className="flex justify-end">
          <Button disabled={!permitted || !ready || preview.isFetching} onClick={() => setConfirming(true)}>Complete move-out</Button>
        </div>
      </CardContent>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Close ${n.lease_reference}?`}
        description={p ? <>The lease ends on {formatDay(movedOut)}, {formatMoney(p.applied_to_balance, currency)} of deposit is applied to the balance and {formatMoney(p.refund, currency)} is refunded.</> : ""}
        confirmLabel="Complete move-out"
        loading={action.isPending}
        // mutateAsync: this card unmounts once the notice is completed, which would drop mutate()'s callbacks.
        onConfirm={() => action.mutateAsync({
          id: n.id,
          action: "complete",
          body: {
            ...params,
            unit_status: unitStatus,
            refund_method: Number(p?.refund) > 0 ? refund.method : "",
            refund_reference: refund.reference,
            notes,
          },
        }).then(
          () => toast.success("Move-out completed"),
          (e) => { setConfirming(false); toast.error(errorMessage(e)); },
        )}
      />
    </Card>
  );
}

function SettlementTable({ preview: p, currency }: { preview: SettlementPreview; currency: string }) {
  const rows: [string, string, boolean?][] = [
    ["Deposit held", p.deposit_held],
    ["Damages deducted", p.damages_deducted],
    ["Balance owed before settlement", p.balance_before],
    ["Deposit applied to balance", p.applied_to_balance],
    ["Refund to tenant", p.refund, true],
    ["Balance still owed after", p.balance_after, true],
  ];
  return (
    <div className="space-y-3">
      <dl className="divide-y rounded-lg border text-sm">
        {rows.map(([label, amount, strong]) => (
          <div key={label} className="flex justify-between gap-4 px-3 py-2">
            <dt className={strong ? "font-medium" : "text-muted-foreground"}>{label}</dt>
            <dd className={strong ? "font-semibold" : ""}>{formatMoney(amount, currency)}</dd>
          </div>
        ))}
      </dl>
      {Number(p.damages_found) !== Number(p.damages_deducted) && (
        <p className="text-xs text-muted-foreground">Damages assessed: {formatMoney(p.damages_found, currency)}</p>
      )}
      {!p.move_out_month_billed && <p className="text-xs text-muted-foreground">The final month hasn&apos;t been billed yet; a prorated bill is issued on completion.</p>}
      {p.notes.map((note) => <Alert key={note} variant="info" title={note} />)}
    </div>
  );
}

function SettlementRecord({ notice: n }: { notice: MoveOutNotice }) {
  const { current } = useOrganization();
  const s = n.settlement as unknown as Partial<SettlementPreview & { moved_out_on: string; unit_status: UnitStatus }>;
  if (!s.deposit_held) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Final settlement</CardTitle>
        <CardDescription>
          Moved out {formatDay(s.moved_out_on)}
          {n.completed_at && ` · completed ${formatDateTime(n.completed_at, current.organization.timezone)}`}
          {s.unit_status && ` · unit set to ${UNIT_STATUS[s.unit_status].label.toLowerCase()}`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SettlementTable preview={{ notes: [], move_out_month_billed: true, ...s } as SettlementPreview} currency={current.organization.currency} />
      </CardContent>
    </Card>
  );
}
