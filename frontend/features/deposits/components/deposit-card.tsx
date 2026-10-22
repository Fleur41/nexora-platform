"use client";

import { Undo2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { useOrganization } from "@/components/providers/organization-provider";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useDeposit, useRecordDeposit, useReverseDeposit, type DepositInput } from "@/features/deposits/api";
import { errorMessage } from "@/lib/api/errors";
import { DEPOSIT_KIND, PAYMENT_METHOD } from "@/lib/labels";
import { formatDay, formatMoney, todayIn } from "@/lib/utils";
import type { DepositTransaction, Lease, PaymentMethod } from "@/types/api";

type Kind = DepositInput["kind"];

/** Security deposit: held separately from rent; it's owed back to the tenant. */
export function DepositCard({ lease }: { lease: Lease }) {
  const { can, current } = useOrganization();
  const deposit = useDeposit(lease.id);
  const reverse = useReverseDeposit(lease.id);
  const [recording, setRecording] = React.useState<Kind | null>(null);
  const [reversing, setReversing] = React.useState<DepositTransaction | null>(null);
  const [reason, setReason] = React.useState("");
  const currency = current.organization.currency;

  if (deposit.isPending) return <Skeleton className="h-40 w-full" />;
  if (deposit.isError) return <ErrorState message={errorMessage(deposit.error)} />;
  const d = deposit.data;
  const noDeposit = Number(d.agreed) === 0 && d.transactions.length === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Deposit</CardTitle>
        <CardDescription>Held for the tenant and kept apart from rent income.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {noDeposit ? (
          <p className="text-sm text-muted-foreground">No deposit on this lease.</p>
        ) : (
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Item label="Agreed" value={formatMoney(d.agreed, currency)} />
            <Item label="Held now" value={formatMoney(d.held, currency)} strong />
            <Item label="Received" value={formatMoney(d.received, currency)} />
            <Item label="Still to collect" value={formatMoney(d.outstanding, currency)} />
            {Number(d.deducted) > 0 && <Item label="Deducted" value={formatMoney(d.deducted, currency)} />}
            {Number(d.refunded) > 0 && <Item label="Refunded" value={formatMoney(d.refunded, currency)} />}
          </dl>
        )}
        <div className="flex flex-wrap gap-2">
          {can("deposits.record") && (
            <Button size="sm" variant="outline" onClick={() => setRecording("received")}>
              Record received
            </Button>
          )}
          {can("deposits.settle") && Number(d.held) > 0 && (
            <>
              <Button size="sm" variant="outline" onClick={() => setRecording("deduction")}>
                Deduct
              </Button>
              <Button size="sm" variant="outline" onClick={() => setRecording("refund")}>
                Refund
              </Button>
            </>
          )}
        </div>
        {d.transactions.length > 0 && (
          <ul className="divide-y border-t text-sm">
            {d.transactions.map((tx) => (
              <li key={tx.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p>
                    {DEPOSIT_KIND[tx.kind]}
                    {tx.reverses_kind && ` of ${DEPOSIT_KIND[tx.reverses_kind].toLowerCase()}`}
                    {tx.is_reversed && <Badge variant="muted" className="ml-2">Reversed</Badge>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {formatDay(tx.transaction_date)}
                    {tx.method && ` · ${PAYMENT_METHOD[tx.method]}`}
                    {tx.reference && ` · ${tx.reference}`}
                    {tx.reason && ` · ${tx.reason}`}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <span>{formatMoney(tx.amount, currency)}</span>
                  {can("deposits.settle") && tx.kind !== "reversal" && !tx.is_reversed && (
                    <Button variant="ghost" size="icon" aria-label="Reverse transaction" onClick={() => setReversing(tx)}>
                      <Undo2 />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <RecordDialog lease={lease} kind={recording} held={d.held} outstanding={d.outstanding} onClose={() => setRecording(null)} />
      <Dialog open={reversing !== null} onOpenChange={(o) => { if (!o) { setReversing(null); setReason(""); reverse.reset(); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reverse this {reversing && DEPOSIT_KIND[reversing.kind].toLowerCase()}?</DialogTitle>
            <DialogDescription>
              The original stays on record; a reversal entry undoes its effect. Recorded in the audit log.
            </DialogDescription>
          </DialogHeader>
          {reverse.isError && <Alert variant="error" title={reverse.error.message} />}
          <FormField id="rev-reason" label="Reason">
            <Input maxLength={255} value={reason} onChange={(e) => setReason(e.target.value)} />
          </FormField>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReversing(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!reason.trim()}
              loading={reverse.isPending}
              onClick={() =>
                reversing &&
                reverse.mutate(
                  { id: reversing.id, reason },
                  {
                    onSuccess: () => {
                      toast.success("Reversed");
                      setReversing(null);
                      setReason("");
                    },
                  },
                )
              }
            >
              Reverse
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function Item({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={strong ? "font-semibold" : undefined}>{value}</dd>
    </div>
  );
}

function RecordDialog({
  lease,
  kind,
  held,
  outstanding,
  onClose,
}: {
  lease: Lease;
  kind: Kind | null;
  held: string;
  outstanding: string;
  onClose: () => void;
}) {
  const { current } = useOrganization();
  const record = useRecordDeposit(lease.id);
  const today = todayIn(current.organization.timezone);
  const [form, setForm] = React.useState({ amount: "", transaction_date: today, method: "mpesa" as PaymentMethod, reference: "", reason: "" });
  const needsReason = kind === "deduction" || kind === "refund";
  const limit = kind === "received" ? null : Number(held);
  const amountOk = /^\d+(\.\d{1,2})?$/.test(form.amount) && Number(form.amount) > 0 && (limit === null || Number(form.amount) <= limit);
  const close = () => {
    record.reset();
    setForm({ amount: "", transaction_date: today, method: "mpesa", reference: "", reason: "" });
    onClose();
  };
  const title = kind === "received" ? "Record deposit received" : kind === "deduction" ? "Deduct from deposit" : "Refund deposit";

  return (
    <Dialog open={kind !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {kind === "received"
              ? `Still to collect: ${formatMoney(outstanding, current.organization.currency)}.`
              : `Held now: ${formatMoney(held, current.organization.currency)}. A reason is required and recorded.`}
          </DialogDescription>
        </DialogHeader>
        {record.isError && <Alert variant="error" title={record.error.message} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="dep-amount" label={`Amount (${current.organization.currency})`}>
            <Input inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </FormField>
          <FormField id="dep-date" label="Date">
            <Input type="date" max={today} value={form.transaction_date} onChange={(e) => setForm({ ...form, transaction_date: e.target.value })} />
          </FormField>
          {kind !== "deduction" && (
            <>
              <FormField id="dep-method" label="Method">
                <NativeSelect value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value as PaymentMethod })}>
                  {Object.entries(PAYMENT_METHOD).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField id="dep-ref" label="Reference (optional)" hint="e.g. M-Pesa code">
                <Input maxLength={64} value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
              </FormField>
            </>
          )}
        </div>
        {needsReason && (
          <FormField id="dep-reason" label="Reason">
            <Input maxLength={255} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </FormField>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button
            disabled={!amountOk || (needsReason && !form.reason.trim())}
            loading={record.isPending}
            onClick={() =>
              kind &&
              record.mutate(
                { kind, ...form, method: kind === "deduction" ? "" : form.method },
                {
                  onSuccess: () => {
                    toast.success("Saved");
                    close();
                  },
                },
              )
            }
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
