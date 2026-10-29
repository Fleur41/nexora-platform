"use client";

import { Building2, Check, Copy, Smartphone } from "lucide-react";
import { useSearchParams } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input, NativeSelect } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { usePortalPay, usePortalSummary } from "@/features/portal/api";
import { useTenancy } from "@/features/portal/tenancy";
import { errorMessage } from "@/lib/api/errors";
import { formatMoney } from "@/lib/utils";
import type { PortalLease, PortalMethod } from "@/types/api";

export function PortalPay() {
  const { tenantId, currency, tenancy } = useTenancy();
  const summary = usePortalSummary(tenantId);
  const [chosen, setChosen] = React.useState("");

  if (summary.isPending) return <Skeleton className="h-96 w-full" />;
  if (summary.isError) return <ErrorState message={errorMessage(summary.error)} onRetry={() => summary.refetch()} />;
  const active = summary.data.leases.filter((l) => l.status === "active");
  if (active.length === 0) {
    return <EmptyState icon={Smartphone} title="No active lease" description={`You don't have an active lease with ${tenancy.organization.name}. Contact them about any balance.`} />;
  }
  const lease = active.find((l) => l.id === chosen) ?? active[0]!;
  const stk = lease.payment_methods.find((m) => m.supports_payment_request);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Pay rent</h1>
        <p className="text-sm text-muted-foreground">
          {Number(lease.balance) > 0 ? <>Balance on this home: <strong>{formatMoney(lease.balance, currency)}</strong></> : "You're all paid up on this home."}
        </p>
      </div>
      {active.length > 1 && (
        <NativeSelect aria-label="Home" value={lease.id} onChange={(e) => setChosen(e.target.value)}>
          {active.map((l) => <option key={l.id} value={l.id}>{l.property_name} unit {l.unit_number}</option>)}
        </NativeSelect>
      )}
      {stk && <StkCard key={lease.id} lease={lease} />}
      {lease.payment_methods.length === 0 ? (
        <Alert title="Payment details not set up yet">
          {tenancy.organization.name} hasn&apos;t added their payment details to Nexora. Ask them how to pay
          {tenancy.organization.phone && ` (${tenancy.organization.phone})`}.
        </Alert>
      ) : (
        <>
          <h2 className="pt-1 text-sm font-semibold text-muted-foreground">{stk ? "Or pay yourself" : "How to pay"}</h2>
          {lease.payment_methods.map((m) => <MethodCard key={`${m.provider}-${m.shortcode}-${m.account_number}`} method={m} />)}
          <p className="text-xs text-muted-foreground">
            Payments are matched to your account using the account number or reference shown. Your receipt appears here once the payment is recorded.
          </p>
        </>
      )}
    </div>
  );
}

function StkCard({ lease }: { lease: PortalLease }) {
  const { tenantId, currency } = useTenancy();
  const params = useSearchParams();
  const pay = usePortalPay(tenantId);
  const suggested = params.get("amount") ?? (Number(lease.balance) > 0 ? String(Math.ceil(Number(lease.balance))) : "");
  const [amount, setAmount] = React.useState(suggested);
  const [phone, setPhone] = React.useState("");
  const valid = /^\d+$/.test(amount) && Number(amount) >= 1 && phone.replace(/\D/g, "").length >= 9;
  return (
    <Card className="border-accent/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Smartphone className="size-5 text-accent-strong" /> Pay with M-Pesa</CardTitle>
        <CardDescription>We&apos;ll send a payment request to your phone. Enter your M-Pesa PIN to confirm.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {pay.isSuccess ? (
          <Alert variant="success" title="Check your phone">
            Enter your M-Pesa PIN to pay {formatMoney(amount, currency)}. Your receipt will appear under Bills &amp; receipts once M-Pesa confirms.
          </Alert>
        ) : (
          <>
            {pay.isError && <Alert variant="error" title={pay.error.message} />}
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField id="stk-amount" label={`Amount (${currency}, whole shillings)`}>
                <Input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} />
              </FormField>
              <FormField id="stk-phone" label="Safaricom number">
                <Input type="tel" inputMode="tel" autoComplete="tel" placeholder="07XX XXX XXX" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </FormField>
            </div>
            <Button className="w-full" size="lg" disabled={!valid} loading={pay.isPending}
              onClick={() => pay.mutate({ lease: lease.id, amount, phone })}>
              Send payment request
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function MethodCard({ method: m }: { method: PortalMethod }) {
  const isBank = m.provider === "bank";
  const rows: [string, string][] = isBank
    ? [["Bank", [m.bank_name, m.bank_branch].filter(Boolean).join(", ")], ["Account name", m.account_name], ["Account number", m.account_number], ["Reference", m.reference_to_use]]
    : m.provider === "mpesa_paybill"
      ? [["Paybill (business number)", m.shortcode], ["Account number", m.account_number_to_use]]
      : [["Till number", m.shortcode]];
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          {isBank ? <Building2 className="size-5 text-muted-foreground" /> : <Smartphone className="size-5 text-muted-foreground" />}
          {m.display_name}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <dl className="divide-y rounded-lg border">
          {rows.filter(([, v]) => v).map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-3 px-3 py-2">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="flex items-center gap-1 font-mono font-medium"><span>{value}</span><CopyButton value={value} label={label} /></dd>
            </div>
          ))}
        </dl>
        {!isBank && m.provider === "mpesa_paybill" && (
          <p className="text-xs text-muted-foreground">M-Pesa → Lipa na M-Pesa → Pay Bill → enter the business number and account number above.</p>
        )}
        {m.provider === "mpesa_till" && <p className="text-xs text-muted-foreground">M-Pesa → Lipa na M-Pesa → Buy Goods and Services → enter the till number.</p>}
        {m.instructions && <p className="whitespace-pre-line text-muted-foreground">{m.instructions}</p>}
      </CardContent>
    </Card>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error("Couldn't copy; select the text instead.");
        }
      }}>
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      <span className="sr-only">Copy {label}</span>
    </button>
  );
}
