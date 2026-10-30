"use client";

import { ArrowLeft, Printer, RotateCcw, Undo2, Wallet } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { useOrganization } from "@/components/providers/organization-provider";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PdfDownloadButton } from "@/components/ui/pdf-download-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { usePayment, usePaymentAction } from "@/features/payments/api";
import { ApiError, errorMessage } from "@/lib/api/errors";
import { PAYMENT_METHOD, PAYMENT_SOURCE } from "@/lib/labels";
import { formatDateTime, formatDay, formatMoney, todayIn } from "@/lib/utils";
import type { PaymentDetail as Detail } from "@/types/api";

export function PaymentDetail() {
  const { id } = useParams<{ id: string }>();
  const { can, current } = useOrganization();
  const payment = usePayment(id);
  const action = usePaymentAction();
  const [dialog, setDialog] = React.useState<"reverse" | "refund" | null>(null);
  const tz = current.organization.timezone;

  if (payment.isPending) return <Skeleton className="h-96 w-full" />;
  if (payment.isError) {
    return (
      <ErrorState
        message={
          payment.error instanceof ApiError && payment.error.status === 404
            ? "This payment doesn't exist or you don't have access to it."
            : errorMessage(payment.error)
        }
      />
    );
  }
  const p = payment.data;
  const currency = current.organization.currency;
  const live = p.status === "completed";
  const credit = Number(p.unallocated);

  return (
    <>
      <Link href="/dashboard/payments" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Payments
      </Link>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{p.receipt_number}</h1>
            {p.status === "reversed" ? <Badge variant="muted">Reversed</Badge> : !p.is_matched ? <Badge variant="warning">Unmatched</Badge> : <Badge variant="accent">Received</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatMoney(p.amount, currency)} · {formatDay(p.received_on)}
            {p.tenant_name && (
              <>
                {" "}·{" "}
                <Link href={`/dashboard/tenants/${p.tenant}`} className="hover:underline">
                  {p.tenant_name}
                </Link>
              </>
            )}
            {p.lease && (
              <>
                {" "}·{" "}
                <Link href={`/dashboard/leases/${p.lease}`} className="hover:underline">
                  {p.lease_reference}
                </Link>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {p.is_matched && live && (
            <Button variant="outline" asChild>
              <Link href={`/dashboard/payments/${p.id}/receipt`}>
                <Printer /> Receipt
              </Link>
            </Button>
          )}
          {p.is_matched && <PdfDownloadButton path={`/payments/${p.id}/pdf/`} filename={`${p.receipt_number}.pdf`}>Receipt PDF</PdfDownloadButton>}
          {live && credit > 0 && can("payments.record") && (
            <Button
              variant="outline"
              loading={action.isPending}
              onClick={() =>
                action.mutate(
                  { id: p.id, action: "allocate", body: {} },
                  {
                    onSuccess: (res) =>
                      toast.success(Number(res.unallocated) < credit ? "Credit applied to open invoices" : "No open invoices to apply it to"),
                    onError: (e) => toast.error(errorMessage(e)),
                  },
                )
              }
            >
              <Wallet /> Apply credit
            </Button>
          )}
          {live && credit > 0 && can("payments.reverse") && (
            <Button variant="outline" onClick={() => setDialog("refund")}>
              <Undo2 /> Refund credit
            </Button>
          )}
          {live && can("payments.reverse") && (
            <Button variant="outline" className="text-destructive" onClick={() => setDialog("reverse")}>
              <RotateCcw /> Reverse
            </Button>
          )}
        </div>
      </div>

      {p.status === "reversed" && (
        <Alert variant="error" className="mb-6" title={`Reversed${p.reversed_by_name ? ` by ${p.reversed_by_name}` : ""}`}>
          {p.reversal_reason}
          {p.reversed_at && ` · ${formatDateTime(p.reversed_at, tz)}`}
        </Alert>
      )}
      {!p.is_matched && live && (
        <Alert className="mb-6" title="Not matched to a tenant yet">
          Match it from Payments → Unmatched so it&apos;s applied to the right invoices.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Applied to</CardTitle>
          </CardHeader>
          <CardContent>
            {p.allocations.length === 0 ? (
              <p className="text-sm text-muted-foreground">Not applied to any invoice.</p>
            ) : (
              <ul className="divide-y text-sm">
                {p.allocations.map((a) => (
                  <li key={a.id} className="flex items-center justify-between py-2">
                    <Link href={`/dashboard/billing/invoices/${a.invoice}`} className="hover:underline">
                      {a.invoice_number}
                    </Link>
                    <span className={a.is_reversed ? "text-muted-foreground line-through" : ""}>{formatMoney(a.amount, currency)}</span>
                  </li>
                ))}
              </ul>
            )}
            {credit > 0 && (
              <p className="mt-3 rounded-lg bg-accent/10 p-3 text-sm text-accent-strong">
                {formatMoney(credit, currency)} held as credit for this tenant. It&apos;s applied to their next invoices automatically.
              </p>
            )}
            {p.refunds.length > 0 && (
              <div className="mt-4 border-t pt-3">
                <p className="mb-2 text-sm font-medium">Refunds</p>
                <ul className="space-y-1 text-sm">
                  {p.refunds.map((r) => (
                    <li key={r.id} className="flex justify-between gap-3">
                      <span className="text-muted-foreground">
                        {formatDay(r.refunded_on)} · {PAYMENT_METHOD[r.method as keyof typeof PAYMENT_METHOD]}
                        {r.reference && ` · ${r.reference}`} · {r.reason}
                      </span>
                      <span>{formatMoney(r.amount, currency)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3 text-sm">
              <Row label="Method" value={PAYMENT_METHOD[p.method as keyof typeof PAYMENT_METHOD] ?? p.method} />
              <Row label="Source" value={PAYMENT_SOURCE[p.source]} />
              {p.configuration_name && <Row label="Paid to" value={`${p.configuration_name}${p.configuration_snapshot.shortcode ? ` (${p.configuration_snapshot.shortcode})` : ""}`} />}
              {p.reference && <Row label="Reference" value={p.reference} />}
              {p.account_reference && <Row label="Account entered" value={p.account_reference} />}
              {p.payer_name && <Row label="Paid by" value={p.payer_name} />}
              {p.payer_phone && <Row label="Phone" value={p.payer_phone} />}
              {p.created_by_name && <Row label="Recorded by" value={p.created_by_name} />}
              {p.notes && <Row label="Notes" value={p.notes} />}
            </dl>
          </CardContent>
        </Card>
      </div>
      <ReverseDialog payment={p} open={dialog === "reverse"} onClose={() => setDialog(null)} />
      <RefundDialog payment={p} open={dialog === "refund"} onClose={() => setDialog(null)} />
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

function ReverseDialog({ payment, open, onClose }: { payment: Detail; open: boolean; onClose: () => void }) {
  const action = usePaymentAction();
  const [reason, setReason] = React.useState("");
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { action.reset(); setReason(""); onClose(); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reverse {payment.receipt_number}?</DialogTitle>
          <DialogDescription>
            For bounced cheques, duplicates or money recorded against the wrong tenant. Every invoice it paid becomes
            due again and the receipt is cancelled. The payment stays on record and the reversal is audited.
          </DialogDescription>
        </DialogHeader>
        {action.isError && <Alert variant="error" title={action.error.message} />}
        <FormField id="rev-reason" label="Reason">
          <Input maxLength={255} value={reason} onChange={(e) => setReason(e.target.value)} />
        </FormField>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!reason.trim()}
            loading={action.isPending}
            onClick={() =>
              action.mutate(
                { id: payment.id, action: "reverse", body: { reason } },
                {
                  onSuccess: () => {
                    toast.success("Payment reversed");
                    setReason("");
                    onClose();
                  },
                },
              )
            }
          >
            Reverse payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RefundDialog({ payment, open, onClose }: { payment: Detail; open: boolean; onClose: () => void }) {
  const { current } = useOrganization();
  const action = usePaymentAction();
  const today = todayIn(current.organization.timezone);
  const [form, setForm] = React.useState({ amount: payment.unallocated, refunded_on: today, method: "mpesa", reference: "", reason: "" });
  const amountOk = /^\d+(\.\d{1,2})?$/.test(form.amount) && Number(form.amount) > 0 && Number(form.amount) <= Number(payment.unallocated);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { action.reset(); onClose(); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Refund credit</DialogTitle>
          <DialogDescription>
            Return unapplied money to the tenant (up to {formatMoney(payment.unallocated, current.organization.currency)}).
          </DialogDescription>
        </DialogHeader>
        {action.isError && <Alert variant="error" title={action.error.message} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="ref-amount" label="Amount">
            <Input inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </FormField>
          <FormField id="ref-date" label="Date">
            <Input type="date" max={today} value={form.refunded_on} onChange={(e) => setForm({ ...form, refunded_on: e.target.value })} />
          </FormField>
          <FormField id="ref-method" label="Paid back via">
            <NativeSelect value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
              {Object.entries(PAYMENT_METHOD).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField id="ref-reference" label="Reference (optional)">
            <Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
          </FormField>
        </div>
        <FormField id="ref-reason" label="Reason">
          <Input maxLength={255} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        </FormField>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!amountOk || !form.reason.trim()}
            loading={action.isPending}
            onClick={() =>
              action.mutate(
                { id: payment.id, action: "refund", body: form },
                {
                  onSuccess: () => {
                    toast.success("Refund recorded");
                    onClose();
                  },
                },
              )
            }
          >
            Record refund
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
