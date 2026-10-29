"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowLeft,
  CalendarPlus,
  CheckCircle2,
  DoorOpen,
  LogOut,
  Trash2,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { useOrganization } from "@/components/providers/organization-provider";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { LeaseStatusBadge } from "@/components/ui/status";
import {
  LeaseAccountCard,
  UnitChargesCard,
} from "@/features/billing/components/lease-account";
import { DepositCard } from "@/features/deposits/components/deposit-card";
import { PaymentInstructionsCard } from "@/features/payments/components/lease-payments";
import { GiveNoticeDialog } from "@/features/moveouts/components/move-outs-page";
import { DocumentsPanel } from "@/features/documents/components/documents-panel";
import {
  useAddRentTerm,
  useLease,
  useLeaseAction,
  useRemoveRentTerm,
} from "@/features/leases/api";
import { ApiError, errorMessage } from "@/lib/api/errors";
import {
  applyServerErrors,
  bannerError,
  moneyString,
  optionalText,
} from "@/lib/forms";
import {
  BILLING_FREQUENCY,
  POST_LEASE_UNIT_STATUSES,
  UNIT_STATUS,
} from "@/lib/labels";
import { formatDateTime, formatDay, formatMoney, todayIn } from "@/lib/utils";
import type { Lease, UnitStatus } from "@/types/api";

export function LeaseDetail() {
  const { id } = useParams<{ id: string }>();
  const { can, current } = useOrganization();
  const lease = useLease(id);
  const action = useLeaseAction();
  const removeTerm = useRemoveRentTerm();
  const [dialog, setDialog] = React.useState<
    "rent" | "end" | "cancel" | "activate" | "notice" | null
  >(null);
  const canManage = can("leases.manage");
  const tz = current.organization.timezone;
  const currency = current.organization.currency;

  if (lease.isPending) return <Skeleton className="h-96 w-full" />;
  if (lease.isError) {
    return (
      <ErrorState
        message={
          lease.error instanceof ApiError && lease.error.status === 404
            ? "This lease doesn't exist or you don't have access to it."
            : errorMessage(lease.error)
        }
      />
    );
  }
  const l = lease.data;
  const today = todayIn(tz);
  const run = (kind: "activate" | "cancel", body?: { reason?: string }) =>
    action.mutate(
      { id: l.id, action: kind, body },
      {
        onSuccess: () => {
          toast.success(
            kind === "activate" ? "Lease activated" : "Draft cancelled",
          );
          setDialog(null);
        },
        onError: (e) => {
          toast.error(errorMessage(e));
          setDialog(null);
        },
      },
    );

  return (
    <>
      <Link
        href="/dashboard/leases"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Leases
      </Link>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {l.reference}
            </h1>
            <LeaseStatusBadge status={l.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {can("tenants.view") ? (
              <Link
                href={`/dashboard/tenants/${l.tenant}`}
                className="hover:underline"
              >
                {l.tenant_name}
              </Link>
            ) : (
              l.tenant_name
            )}{" "}
            ·{" "}
            <Link
              href={`/dashboard/properties/${l.property_id}`}
              className="hover:underline"
            >
              {l.property_name}
            </Link>{" "}
            · Unit {l.unit_number}
          </p>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            {l.status === "draft" && (
              <>
                <Button onClick={() => setDialog("activate")}>
                  <CheckCircle2 /> Activate
                </Button>
                <Button variant="outline" onClick={() => setDialog("cancel")}>
                  <XCircle /> Cancel draft
                </Button>
              </>
            )}
            {(l.status === "draft" || l.status === "active") && (
              <Button variant="outline" onClick={() => setDialog("rent")}>
                <CalendarPlus /> Schedule rent change
              </Button>
            )}
            {l.status === "active" && can("moveouts.manage") && (
              <Button variant="outline" onClick={() => setDialog("notice")}>
                <DoorOpen /> Record move-out notice
              </Button>
            )}
            {l.status === "active" && (
              <Button variant="outline" onClick={() => setDialog("end")}>
                <LogOut /> End lease
              </Button>
            )}
          </div>
        )}
      </div>

      {l.status === "draft" && (
        <Alert className="mb-6" title="This lease is a draft">
          The unit is not reserved until you activate it. Drafts can still be
          edited or cancelled.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {can("billing.view") &&
            l.status !== "draft" &&
            l.status !== "cancelled" && <LeaseAccountCard lease={l} />}
          <Card>
            <CardHeader>
              <CardTitle>Rent schedule</CardTitle>
              <CardDescription>
                Each change applies from its date onward. Past periods keep the
                rent that was in force at the time.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="relative space-y-4 border-l pl-6">
                {l.rent_terms.map((term, i) => {
                  const isFuture = term.effective_from > today;
                  const next = l.rent_terms[i + 1];
                  const inForce =
                    !isFuture && (!next || next.effective_from > today);
                  const removable =
                    canManage &&
                    i > 0 &&
                    (l.status === "draft" || isFuture) &&
                    l.status !== "ended";
                  return (
                    <li key={term.id} className="relative">
                      <span
                        className={`absolute -left-[31px] top-1.5 size-3 rounded-full border-2 border-background ${inForce ? "bg-accent" : isFuture ? "bg-sky-400" : "bg-muted-foreground/40"}`}
                        aria-hidden
                      />
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">
                            {formatMoney(term.monthly_rent, currency)}
                            <span className="font-normal text-muted-foreground">
                              {" "}
                              / month
                            </span>
                          </p>
                          <p className="text-sm text-muted-foreground">
                            From {formatDay(term.effective_from)}
                            {term.note && ` · ${term.note}`}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {inForce && <Badge variant="accent">Current</Badge>}
                          {isFuture && (
                            <Badge variant="outline">Scheduled</Badge>
                          )}
                          {removable && (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Remove scheduled change"
                              disabled={removeTerm.isPending}
                              onClick={() =>
                                removeTerm.mutate(
                                  { leaseId: l.id, termId: term.id },
                                  {
                                    onSuccess: () =>
                                      toast.success("Scheduled change removed"),
                                    onError: (e) =>
                                      toast.error(errorMessage(e)),
                                  },
                                )
                              }
                            >
                              <Trash2 />
                            </Button>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Documents</CardTitle>
            </CardHeader>
            <CardContent>
              <DocumentsPanel
                target="lease"
                targetId={l.id}
                canManage={canManage}
                categories={["lease_agreement", "other"]}
              />
            </CardContent>
          </Card>
        </div>
        <div className="space-y-6">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3 text-sm">
                <Row
                  label="Current rent"
                  value={formatMoney(l.current_rent, currency)}
                />
                <Row
                  label="Deposit"
                  value={
                    Number(l.deposit_amount)
                      ? formatMoney(l.deposit_amount, currency)
                      : "No deposit"
                  }
                />
                <Row
                  label="Billing"
                  value={`${BILLING_FREQUENCY[l.billing_frequency]}, due on day ${l.rent_due_day}`}
                />
                <Row label="Start" value={formatDay(l.start_date)} />
                <Row
                  label="Contract end"
                  value={
                    l.end_date
                      ? formatDay(l.end_date)
                      : "Periodic (no fixed end)"
                  }
                />
                {l.ended_on && (
                  <Row label="Ended on" value={formatDay(l.ended_on)} />
                )}
                {l.end_reason && <Row label="Reason" value={l.end_reason} />}
                {l.activated_at && (
                  <Row
                    label="Activated"
                    value={formatDateTime(l.activated_at, tz)}
                  />
                )}
                {l.notes && <Row label="Notes" value={l.notes} />}
                <Row label="Tenant phone" value={l.tenant_phone} />
              </dl>
            </CardContent>
          </Card>
          {can("deposits.view") && l.status !== "cancelled" && (
            <DepositCard lease={l} />
          )}
          {can("payments.view") && l.status === "active" && (
            <PaymentInstructionsCard lease={l} />
          )}
          {can("billing.view") && l.status === "active" && (
            <UnitChargesCard lease={l} />
          )}
        </div>
      </div>

      <RentChangeDialog
        lease={l}
        open={dialog === "rent"}
        onOpenChange={(o) => setDialog(o ? "rent" : null)}
      />
      <GiveNoticeDialog
        lease={{ id: l.id, label: `${l.reference} · ${l.tenant_name}` }}
        open={dialog === "notice"}
        onOpenChange={(o) => setDialog(o ? "notice" : null)}
      />
      <EndLeaseDialog
        lease={l}
        open={dialog === "end"}
        onOpenChange={(o) => setDialog(o ? "end" : null)}
      />
      <ConfirmDialog
        open={dialog === "activate"}
        onOpenChange={(o) => setDialog(o ? "activate" : null)}
        title="Activate lease?"
        description={`Unit ${l.unit_number} will be marked ${l.start_date > today ? "reserved until the start date" : "occupied"}. Terms can no longer be edited after this.`}
        confirmLabel="Activate"
        loading={action.isPending}
        onConfirm={() => run("activate")}
      />
      <ConfirmDialog
        open={dialog === "cancel"}
        onOpenChange={(o) => setDialog(o ? "cancel" : null)}
        title="Cancel this draft?"
        description="The draft is kept for the record but can no longer be activated."
        confirmLabel="Cancel draft"
        destructive
        loading={action.isPending}
        onConfirm={() => run("cancel")}
      />
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

const rentSchema = z.object({
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date."),
  monthly_rent: moneyString("the new rent"),
  note: optionalText(255),
});

function RentChangeDialog({
  lease,
  open,
  onOpenChange,
}: {
  lease: Lease;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { current } = useOrganization();
  const add = useAddRentTerm();
  const [banner, setBanner] = React.useState<string | null>(null);
  const form = useForm<z.infer<typeof rentSchema>>({
    resolver: zodResolver(rentSchema),
    defaultValues: {
      effective_from: "",
      monthly_rent: lease.current_rent ?? "",
      note: "",
    },
  });
  const errors = form.formState.errors;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          form.reset();
          setBanner(null);
        }
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Schedule a rent change</DialogTitle>
          <DialogDescription>
            {lease.status === "active"
              ? "Changes on an active lease must start after today."
              : "The new rent applies from the date you choose."}
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="space-y-4"
          onSubmit={form.handleSubmit((v) =>
            add.mutate(
              { leaseId: lease.id, ...v },
              {
                onSuccess: () => {
                  toast.success("Rent change scheduled");
                  form.reset();
                  onOpenChange(false);
                },
                onError: (err) =>
                  setBanner(bannerError(err, applyServerErrors(err, form))),
              },
            ),
          )}
        >
          {banner && <Alert variant="error" title={banner} />}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              id="r-date"
              label="Effective from"
              error={errors.effective_from?.message}
            >
              <Input
                type="date"
                min={lease.start_date}
                {...form.register("effective_from")}
              />
            </FormField>
            <FormField
              id="r-amount"
              label={`New monthly rent (${current.organization.currency})`}
              error={errors.monthly_rent?.message}
            >
              <Input inputMode="decimal" {...form.register("monthly_rent")} />
            </FormField>
          </div>
          <FormField
            id="r-note"
            label="Note (optional)"
            error={errors.note?.message}
          >
            <Input
              placeholder="e.g. Annual 5% review"
              {...form.register("note")}
            />
          </FormField>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" loading={add.isPending}>
              Schedule
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EndLeaseDialog({
  lease,
  open,
  onOpenChange,
}: {
  lease: Lease;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { current } = useOrganization();
  const action = useLeaseAction();
  const today = todayIn(current.organization.timezone);
  const [endedOn, setEndedOn] = React.useState(today);
  const [unitStatus, setUnitStatus] = React.useState<UnitStatus>(
    "awaiting_inspection",
  );
  const [reason, setReason] = React.useState("");

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) action.reset();
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>End lease {lease.reference}</DialogTitle>
          <DialogDescription>
            Close the tenancy once the tenant has left. The lease and its
            history stay on record. To settle the deposit and final bill in one
            step, record a move-out notice instead.
          </DialogDescription>
        </DialogHeader>
        {action.isError && (
          <Alert variant="error" title={action.error.message} />
        )}
        <div className="space-y-4">
          <FormField
            id="e-date"
            label="Last day of tenancy"
            hint="Cannot be in the future."
          >
            <Input
              type="date"
              min={lease.start_date}
              max={today}
              value={endedOn}
              onChange={(e) => setEndedOn(e.target.value)}
            />
          </FormField>
          <FormField
            id="e-status"
            label={`Unit ${lease.unit_number} should become`}
          >
            <NativeSelect
              value={unitStatus}
              onChange={(e) => setUnitStatus(e.target.value as UnitStatus)}
            >
              {POST_LEASE_UNIT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {UNIT_STATUS[s].label}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField id="e-reason" label="Reason (optional)">
            <Input
              maxLength={255}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            loading={action.isPending}
            disabled={!endedOn}
            onClick={() =>
              action.mutate(
                {
                  id: lease.id,
                  action: "end",
                  body: { ended_on: endedOn, unit_status: unitStatus, reason },
                },
                {
                  onSuccess: () => {
                    toast.success("Lease ended");
                    onOpenChange(false);
                  },
                },
              )
            }
          >
            End lease
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
