"use client";

import { FilePlus2 } from "lucide-react";
import Link from "next/link";
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
import { useChargeTypes, useCreateOneOffInvoice, useLeaseAccount, useResolvedCharges } from "@/features/billing/api";
import { LeasePaymentActions } from "@/features/payments/components/lease-payments";
import { errorMessage } from "@/lib/api/errors";
import { RULE_METHOD } from "@/lib/labels";
import { formatDay, formatMoney } from "@/lib/utils";
import type { Lease } from "@/types/api";

const ENTRY = {
  invoice: "Invoice",
  credit: "Credit",
  void: "Void",
  payment: "Payment",
  allocation: "Allocation",
  payment_reversal: "Payment reversed",
  refund: "Credit refunded",
} as const;

/** Balance and statement for a lease. */
export function LeaseAccountCard({ lease }: { lease: Lease }) {
  const { can } = useOrganization();
  const account = useLeaseAccount(lease.id);
  const [raising, setRaising] = React.useState(false);
  const currency = account.data?.currency;
  const canRaise = can("billing.generate") && (lease.status === "active" || lease.status === "ended");

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Account</CardTitle>
          <CardDescription>Everything billed, paid and credited on this lease.</CardDescription>
        </div>
        <div className="flex flex-wrap justify-end gap-2 [&_button]:h-9 [&_button]:px-3">
          <LeasePaymentActions lease={lease} />
          {canRaise && (
            <Button variant="outline" size="sm" onClick={() => setRaising(true)}>
              <FilePlus2 /> One-off invoice
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {account.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : account.isError ? (
          <ErrorState message={errorMessage(account.error)} />
        ) : (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-muted/60 p-3">
                <p className="text-xs text-muted-foreground">Balance</p>
                <p className="text-xl font-semibold">{formatMoney(account.data.balance, currency)}</p>
              </div>
              <div className="rounded-lg bg-muted/60 p-3">
                <p className="text-xs text-muted-foreground">Overdue</p>
                <p className={`text-xl font-semibold ${Number(account.data.overdue) > 0 ? "text-destructive" : ""}`}>
                  {formatMoney(account.data.overdue, currency)}
                </p>
              </div>
            </div>
            {account.data.entries.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing billed yet. Generate invoices from Billing.</p>
            ) : (
              <ul className="max-h-80 divide-y overflow-y-auto text-sm">
                {[...account.data.entries].reverse().map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate">
                        {ENTRY[e.entry_type]}
                        {/* Payments carry their receipt number; invoices/credits their own reference. */}
                        {e.reference && e.reference !== e.invoice_number && ` ${e.reference}`}
                        {e.invoice && (
                          <>
                            {e.reference && e.reference !== e.invoice_number ? " → " : " "}
                            <Link href={`/dashboard/billing/invoices/${e.invoice}`} className="hover:underline">
                              {e.invoice_number}
                            </Link>
                          </>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDay(e.effective_date)}
                        {e.reason && ` · ${e.reason}`}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={Number(e.amount) < 0 ? "text-accent-strong" : ""}>{formatMoney(e.amount, currency)}</p>
                      <p className="text-xs text-muted-foreground">bal. {formatMoney(e.balance, currency)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>
      <OneOffInvoiceDialog lease={lease} open={raising} onOpenChange={setRaising} />
    </Card>
  );
}

/** Which charges apply to the lease's unit today, and why. */
export function UnitChargesCard({ lease }: { lease: Lease }) {
  const { current } = useOrganization();
  const resolved = useResolvedCharges(lease.unit);
  const currency = current.organization.currency;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Charges on this unit</CardTitle>
        <CardDescription>
          Besides rent, as of today. Manage these under{" "}
          <Link href="/dashboard/charges" className="text-primary hover:underline">
            Charges
          </Link>
          .
        </CardDescription>
      </CardHeader>
      <CardContent>
        {resolved.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : resolved.isError ? (
          <ErrorState message={errorMessage(resolved.error)} />
        ) : resolved.data.charges.length === 0 ? (
          <p className="text-sm text-muted-foreground">No other charges. The tenant is billed rent only.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {resolved.data.charges.map((c) => (
              <li key={c.charge_type} className="flex items-center justify-between gap-3">
                <span>
                  {c.charge_type_name}
                  <span className="block text-xs text-muted-foreground">{RULE_METHOD[c.method]}</span>
                </span>
                {c.included_in_rent ? (
                  <Badge variant="outline">Included in rent</Badge>
                ) : !c.is_enabled ? (
                  <Badge variant="muted">Not charged</Badge>
                ) : c.method === "shared" ? (
                  <Badge variant="default">Shared</Badge>
                ) : (
                  <span>
                    {formatMoney(c.amount, currency)}
                    {c.method === "metered" ? ` / ${c.usage_unit || "unit"}` : c.method === "fixed_monthly" ? " / mo" : ""}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

interface Row {
  charge_type: string;
  description: string;
  amount: string;
}

function OneOffInvoiceDialog({ lease, open, onOpenChange }: { lease: Lease; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { current } = useOrganization();
  const types = useChargeTypes();
  const create = useCreateOneOffInvoice();
  const [rows, setRows] = React.useState<Row[]>([{ charge_type: "", description: "", amount: "" }]);
  const [due, setDue] = React.useState("");
  const valid = rows.every((r) => r.charge_type && r.description.trim() && /^\d+(\.\d{1,2})?$/.test(r.amount) && Number(r.amount) > 0);
  const total = rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  const setRow = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (i === j ? { ...r, ...patch } : r)));

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) create.reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>One-off invoice</DialogTitle>
          <DialogDescription>
            For occasional charges (e.g. a replacement key) or an opening balance when moving an
            existing tenant onto Nexora. Posted immediately and can&apos;t be edited later.
          </DialogDescription>
        </DialogHeader>
        {create.isError && <Alert variant="error" title={create.error.message} />}
        <div className="space-y-3">
          {rows.map((row, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[10rem_1fr_8rem]">
              <NativeSelect aria-label="Charge" value={row.charge_type} onChange={(e) => setRow(i, { charge_type: e.target.value })}>
                <option value="">Charge…</option>
                {types.data?.filter((t) => t.is_active).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </NativeSelect>
              <Input aria-label="Description" placeholder="Description" maxLength={255} value={row.description} onChange={(e) => setRow(i, { description: e.target.value })} />
              <Input aria-label="Amount" inputMode="decimal" placeholder="Amount" value={row.amount} onChange={(e) => setRow(i, { amount: e.target.value })} />
            </div>
          ))}
          <Button variant="ghost" size="sm" onClick={() => setRows([...rows, { charge_type: "", description: "", amount: "" }])} disabled={rows.length >= 10}>
            Add line
          </Button>
          <div className="flex items-end justify-between gap-4">
            <div className="w-48">
              <FormField id="oo-due" label="Due date (optional)">
                <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
              </FormField>
            </div>
            <p className="text-sm">
              Total <strong>{formatMoney(total, current.organization.currency)}</strong>
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!valid}
            loading={create.isPending}
            onClick={() =>
              create.mutate(
                { lease: lease.id, due_date: due || null, notes: "", lines: rows },
                {
                  onSuccess: (inv) => {
                    toast.success(`Invoice ${inv.number} posted`);
                    setRows([{ charge_type: "", description: "", amount: "" }]);
                    setDue("");
                    onOpenChange(false);
                  },
                },
              )
            }
          >
            Post invoice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
