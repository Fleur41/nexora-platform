"use client";

import { Check, Smartphone } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/page-header";
import { useOrganization } from "@/components/providers/organization-provider";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useChangePlan, usePayNexoraInvoice, useSubscription, useSubscriptionInvoices } from "@/features/subscription/api";
import { errorMessage } from "@/lib/api/errors";
import { cn, formatDay, formatMoney } from "@/lib/utils";
import type { Plan, SubscriptionStatus, SubscriptionSummary } from "@/types/api";

export const SUBSCRIPTION_STATUS: Record<SubscriptionStatus, { label: string; variant: "default" | "accent" | "warning" | "destructive" | "muted" }> = {
  trialing: { label: "Free trial", variant: "default" },
  active: { label: "Active", variant: "accent" },
  past_due: { label: "Payment overdue", variant: "warning" },
  lapsed: { label: "Read-only", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "muted" },
};

const price = (p: Plan) => (Number(p.monthly_price) > 0 ? `${formatMoney(p.monthly_price, p.currency)} / month` : "Priced by agreement");

export function SubscriptionPage() {
  const { can } = useOrganization();
  const allowed = can("subscription.manage");
  const summary = useSubscription(allowed);
  const invoices = useSubscriptionInvoices(allowed);
  if (!allowed) return <Alert variant="error" title="Only the organization's owners manage the Nexora subscription." />;
  if (summary.isPending) return <Skeleton className="h-96 w-full" />;
  if (summary.isError) return <ErrorState message={errorMessage(summary.error)} onRetry={() => summary.refetch()} />;
  const s = summary.data;
  return (
    <>
      <PageHeader title="Subscription" description="Your Nexora plan, what you've used, and paying Nexora." />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <CurrentPlan summary={s} />
          {s.open_invoice && <PayInvoice summary={s} />}
          <Plans summary={s} />
        </div>
        <Card className="h-fit">
          <CardHeader><CardTitle>Invoices from Nexora</CardTitle></CardHeader>
          <CardContent className="px-0 pb-2">
            {invoices.data?.length ? (
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Invoice</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.data.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell>{i.number}<p className="text-xs text-muted-foreground">{formatDay(i.period_start)} – {formatDay(i.period_end)}</p></TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(i.amount, i.currency)}</TableCell>
                      <TableCell><Badge variant={i.status === "paid" ? "accent" : i.status === "open" ? "warning" : "muted"}>{i.status === "open" ? "Unpaid" : i.status === "paid" ? "Paid" : "Void"}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="px-6 pb-4 text-sm text-muted-foreground">No invoices yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function CurrentPlan({ summary: s }: { summary: SubscriptionSummary }) {
  const used = s.units_used ?? 0;
  const limit = s.plan.max_units;
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {s.plan.name} plan <Badge variant={SUBSCRIPTION_STATUS[s.status].variant}>{SUBSCRIPTION_STATUS[s.status].label}</Badge>
          {s.complimentary && <Badge variant="muted">Complimentary</Badge>}
        </CardTitle>
        <CardDescription>
          {s.complimentary
            ? "Provided free of charge by Nexora."
            : s.status === "trialing"
              ? `Free trial until ${formatDay(s.trial_ends_on)}${s.days_left !== null ? ` (${s.days_left} day${s.days_left === 1 ? "" : "s"} left)` : ""}.`
              : s.paid_until
                ? `Paid through ${formatDay(s.paid_until)}.`
                : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex justify-between"><span>Units</span><span className="tabular-nums">{used}{limit ? ` of ${limit}` : " (unlimited)"}</span></div>
        {limit && (
          <div className="h-2 overflow-hidden rounded-full bg-muted" role="meter" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used} aria-label="Units used">
            <div className={cn("h-full rounded-full", pct >= 90 ? "bg-warning" : "bg-accent")} style={{ width: `${pct}%` }} />
          </div>
        )}
        {s.read_only && <Alert variant="error" title="Nexora is read-only">You can view everything, but changes are blocked until the open invoice is paid.</Alert>}
      </CardContent>
    </Card>
  );
}

function PayInvoice({ summary: s }: { summary: SubscriptionSummary }) {
  const invoice = s.open_invoice!;
  const pay = usePayNexoraInvoice();
  const [phone, setPhone] = React.useState("");
  const p = s.payment!;
  return (
    <Card className="border-warning/50">
      <CardHeader>
        <CardTitle>Invoice {invoice.number}: {formatMoney(invoice.amount, invoice.currency)}</CardTitle>
        <CardDescription>{invoice.plan_name} plan, {formatDay(invoice.period_start)} – {formatDay(invoice.period_end)}. Due {formatDay(invoice.due_date)}.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {p.stk_available && (
          pay.isSuccess ? (
            <Alert variant="success" title="Check your phone">Enter your M-Pesa PIN to pay. The invoice is marked paid as soon as M-Pesa confirms.</Alert>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <FormField id="nx-phone" label="Pay with M-Pesa: Safaricom number">
                <Input type="tel" placeholder="07XX XXX XXX" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </FormField>
              <Button disabled={phone.replace(/\D/g, "").length < 9} loading={pay.isPending}
                onClick={() => pay.mutate({ id: invoice.id, phone }, { onError: (e) => toast.error(errorMessage(e)) })}>
                <Smartphone /> Send payment request
              </Button>
            </div>
          )
        )}
        <dl className="grid gap-x-6 gap-y-1 rounded-lg bg-muted/60 p-3 sm:grid-cols-2">
          {p.paybill && <><dt className="text-muted-foreground">M-Pesa paybill</dt><dd className="font-mono font-medium">{p.paybill}</dd></>}
          <dt className="text-muted-foreground">Account number</dt><dd className="font-mono font-medium">{p.account}</dd>
          {p.bank_account && <><dt className="text-muted-foreground">Bank</dt><dd className="font-medium">{p.bank_name} · {p.bank_account} (reference {p.account})</dd></>}
        </dl>
        <p className="text-xs text-muted-foreground">Payments to the paybill or bank are recorded by Nexora, usually within a working day.</p>
      </CardContent>
    </Card>
  );
}

function Plans({ summary: s }: { summary: SubscriptionSummary }) {
  const change = useChangePlan();
  const [chosen, setChosen] = React.useState<Plan | null>(null);
  const used = s.units_used ?? 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Plans</CardTitle>
        <CardDescription>Plans differ by how many units you manage. Changes apply now; an unpaid invoice is re-priced.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        {(s.plans ?? []).map((p) => {
          const current = p.code === s.plan.code;
          const tooSmall = p.max_units !== null && used > p.max_units;
          return (
            <div key={p.id} className={cn("flex flex-col gap-2 rounded-xl border p-4", current && "border-primary ring-1 ring-primary")}>
              <div className="flex items-center justify-between">
                <p className="font-semibold">{p.name}</p>
                {current && <Badge variant="accent"><Check className="mr-1 size-3" />Current</Badge>}
              </div>
              <p className="text-sm text-muted-foreground">{p.max_units ? `Up to ${p.max_units} units` : "Unlimited units"}</p>
              <p className="text-sm font-medium">{price(p)}</p>
              {!current && (
                <Button size="sm" variant="outline" className="mt-auto" disabled={tooSmall} title={tooSmall ? `You have ${used} units` : undefined} onClick={() => setChosen(p)}>
                  {tooSmall ? `Too small for ${used} units` : `Switch to ${p.name}`}
                </Button>
              )}
            </div>
          );
        })}
      </CardContent>
      <ConfirmDialog
        open={chosen !== null}
        onOpenChange={(o) => !o && setChosen(null)}
        title={`Switch to ${chosen?.name}?`}
        description={chosen ? <>{price(chosen)}. {chosen.max_units ? `Up to ${chosen.max_units} units.` : "Unlimited units."} It applies from your next invoice.</> : ""}
        confirmLabel="Switch plan"
        loading={change.isPending}
        onConfirm={() => change.mutate(chosen!.code, {
          onSuccess: () => { toast.success(`You're on the ${chosen!.name} plan`); setChosen(null); },
          onError: (e) => { toast.error(errorMessage(e)); setChosen(null); },
        })}
      />
    </Card>
  );
}
