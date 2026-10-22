"use client";

import { ArrowLeft, Ban, BadgePercent } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { useOrganization } from "@/components/providers/organization-provider";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useInvoice, useInvoiceAction } from "@/features/billing/api";
import { ApiError, errorMessage } from "@/lib/api/errors";
import { INVOICE_KIND } from "@/lib/labels";
import { formatDateTime, formatDay, formatMoney } from "@/lib/utils";
import type { InvoiceDetail as Detail } from "@/types/api";

import { InvoiceStatusBadge } from "./invoice-status";

const ENTRY_LABEL = {
  invoice: "Invoice issued",
  credit: "Credit",
  void: "Voided",
  payment: "Payment",
  allocation: "Credit applied",
  payment_reversal: "Payment reversed",
  refund: "Credit refunded",
} as const;

export function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const { can, current } = useOrganization();
  const invoice = useInvoice(id);
  const [dialog, setDialog] = React.useState<"void" | "credit" | null>(null);
  const tz = current.organization.timezone;

  if (invoice.isPending) return <Skeleton className="h-96 w-full" />;
  if (invoice.isError) {
    return (
      <ErrorState
        message={
          invoice.error instanceof ApiError && invoice.error.status === 404
            ? "This invoice doesn't exist or you don't have access to it."
            : errorMessage(invoice.error)
        }
      />
    );
  }
  const inv = invoice.data;
  const currency = inv.currency;
  const canAdjust = can("billing.adjust") && inv.status === "issued";
  const hasMovements = inv.ledger_entries.some((e) => e.entry_type !== "invoice");

  return (
    <>
      <Link href="/dashboard/billing" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Billing
      </Link>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{inv.number}</h1>
            <InvoiceStatusBadge invoice={inv} timeZone={tz} />
            {inv.kind !== "regular" && <Badge variant="outline">{INVOICE_KIND[inv.kind]}</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            <Link href={`/dashboard/tenants/${inv.tenant}`} className="hover:underline">
              {inv.tenant_name}
            </Link>{" "}
            ·{" "}
            <Link href={`/dashboard/leases/${inv.lease}`} className="hover:underline">
              {inv.lease_reference}
            </Link>{" "}
            · {inv.property_name} {inv.unit_number}
          </p>
        </div>
        {canAdjust && (
          <div className="flex gap-2">
            <Button variant="outline" disabled={Number(inv.amount_due) <= 0} onClick={() => setDialog("credit")}>
              <BadgePercent /> Credit
            </Button>
            <Button
              variant="outline"
              className="text-destructive"
              disabled={hasMovements}
              title={hasMovements ? "Credited or paid invoices can't be voided; credit the balance instead" : undefined}
              onClick={() => setDialog("void")}
            >
              <Ban /> Void
            </Button>
          </div>
        )}
      </div>

      {inv.status === "void" && (
        <Alert variant="error" className="mb-6" title={`Voided${inv.voided_by_name ? ` by ${inv.voided_by_name}` : ""}`}>
          {inv.void_reason}
          {inv.voided_at && ` · ${formatDateTime(inv.voided_at, tz)}`}
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Lines</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Qty</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inv.lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell>
                      {line.description}
                      <p className="text-xs text-muted-foreground">{line.charge_type_name}</p>
                    </TableCell>
                    <TableCell className="hidden text-right sm:table-cell">
                      {Number(line.quantity) !== 1 ? `${Number(line.quantity)} × ${formatMoney(line.unit_price, currency)}` : ""}
                    </TableCell>
                    <TableCell className="text-right">{formatMoney(line.amount, currency)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-semibold hover:bg-transparent">
                  <TableCell>Total</TableCell>
                  <TableCell className="hidden sm:table-cell" />
                  <TableCell className="text-right">{formatMoney(inv.total, currency)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3 text-sm">
                <Row label="Amount due" value={formatMoney(inv.amount_due, currency)} strong />
                <Row label="Issued" value={formatDay(inv.issue_date)} />
                <Row label="Due" value={formatDay(inv.due_date)} />
                {inv.period_start && <Row label="Period" value={`${formatDay(inv.period_start)} – ${formatDay(inv.period_end)}`} />}
                {inv.created_by_name && <Row label="Raised by" value={inv.created_by_name} />}
                {inv.notes && <Row label="Notes" value={inv.notes} />}
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3 text-sm">
                {inv.ledger_entries.map((e) => (
                  <li key={e.id} className="flex justify-between gap-3">
                    <div>
                      <p>
                        {ENTRY_LABEL[e.entry_type]}
                        {e.entry_type !== "invoice" && e.reference && ` ${e.reference}`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDay(e.effective_date)}
                        {e.created_by_name && ` · ${e.created_by_name}`}
                        {e.reason && ` · ${e.reason}`}
                      </p>
                    </div>
                    <span className={Number(e.amount) < 0 ? "text-accent-strong" : ""}>{formatMoney(e.amount, currency)}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
      <AdjustDialog invoice={inv} kind={dialog} onClose={() => setDialog(null)} />
    </>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={strong ? "font-semibold" : "text-right"}>{value}</dd>
    </div>
  );
}

function AdjustDialog({ invoice, kind, onClose }: { invoice: Detail; kind: "void" | "credit" | null; onClose: () => void }) {
  const action = useInvoiceAction();
  const [amount, setAmount] = React.useState("");
  const [reason, setReason] = React.useState("");
  const amountOk = kind === "void" || (/^\d+(\.\d{1,2})?$/.test(amount) && Number(amount) > 0 && Number(amount) <= Number(invoice.amount_due));

  const close = () => {
    setAmount("");
    setReason("");
    action.reset();
    onClose();
  };

  return (
    <Dialog open={kind !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{kind === "void" ? `Void ${invoice.number}?` : `Credit ${invoice.number}`}</DialogTitle>
          <DialogDescription>
            {kind === "void"
              ? "The whole invoice is reversed in the tenant's account. The period can then be billed again. This is recorded in the audit log."
              : `Reduces what the tenant owes on this invoice (up to ${formatMoney(invoice.amount_due, invoice.currency)}). Recorded with your reason in the audit log.`}
          </DialogDescription>
        </DialogHeader>
        {action.isError && <Alert variant="error" title={action.error.message} />}
        <div className="space-y-4">
          {kind === "credit" && (
            <FormField id="adj-amount" label={`Amount (${invoice.currency})`}>
              <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </FormField>
          )}
          <FormField id="adj-reason" label="Reason">
            <Input maxLength={255} value={reason} onChange={(e) => setReason(e.target.value)} />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button
            variant={kind === "void" ? "destructive" : "default"}
            disabled={!reason.trim() || !amountOk}
            loading={action.isPending}
            onClick={() =>
              kind &&
              action.mutate(
                { id: invoice.id, action: kind, body: kind === "void" ? { reason } : { reason, amount } },
                {
                  onSuccess: () => {
                    toast.success(kind === "void" ? "Invoice voided" : "Credit applied");
                    close();
                  },
                },
              )
            }
          >
            {kind === "void" ? "Void invoice" : "Apply credit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
