"use client";

import { Banknote, Smartphone } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { useOrganization } from "@/components/providers/organization-provider";
import { Alert } from "@/components/ui/alert";
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
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useLeaseAccount } from "@/features/billing/api";
import { usePaymentInstructions, useRequestMpesaPayment } from "@/features/payments/api";
import type { Lease } from "@/types/api";

import { RecordPaymentDialog } from "./record-payment-dialog";

/** Payment buttons shown on the lease page. */
export function LeasePaymentActions({ lease }: { lease: Lease }) {
  const { can } = useOrganization();
  const instructions = usePaymentInstructions(lease.id, can("payments.view"));
  const [recording, setRecording] = React.useState(false);
  const [prompting, setPrompting] = React.useState(false);
  const canPrompt = lease.status === "active" && instructions.data?.methods.some((m) => m.supports_payment_request);
  if (!can("payments.record") || (lease.status !== "active" && lease.status !== "ended")) return null;
  return (
    <>
      <Button onClick={() => setRecording(true)}>
        <Banknote /> Record payment
      </Button>
      {canPrompt && (
        <Button variant="outline" onClick={() => setPrompting(true)}>
          <Smartphone /> Request via M-Pesa
        </Button>
      )}
      <RecordPaymentDialog open={recording} onOpenChange={setRecording} leaseId={lease.id} />
      <StkDialog lease={lease} open={prompting} onOpenChange={setPrompting} />
    </>
  );
}

function StkDialog({ lease, open, onOpenChange }: { lease: Lease; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { current } = useOrganization();
  const account = useLeaseAccount(lease.id, open);
  const send = useRequestMpesaPayment();
  const owed = account.data ? Math.max(Math.ceil(Number(account.data.balance)), 0) : 0;
  const [amount, setAmount] = React.useState("");
  const [phone, setPhone] = React.useState(lease.tenant_phone);
  const value = amount || (owed ? String(owed) : "");
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) send.reset(); onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request payment via M-Pesa</DialogTitle>
          <DialogDescription>
            Sends a payment prompt to the tenant&apos;s phone. When they enter their PIN, Safaricom confirms it and the
            payment is recorded and receipted automatically.
          </DialogDescription>
        </DialogHeader>
        {send.isError && <Alert variant="error" title={send.error.message} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="stk-amount" label={`Amount (${current.organization.currency}, whole shillings)`}>
            <Input inputMode="numeric" value={value} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} />
          </FormField>
          <FormField id="stk-phone" label="Safaricom number">
            <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!value || Number(value) < 1 || !phone}
            loading={send.isPending}
            onClick={() =>
              send.mutate(
                { lease: lease.id, amount: value, phone },
                {
                  onSuccess: () => {
                    toast.success("Payment prompt sent to the tenant's phone");
                    onOpenChange(false);
                  },
                },
              )
            }
          >
            Send prompt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** How the tenant on this lease should pay (the landlord's enabled methods). */
export function PaymentInstructionsCard({ lease }: { lease: Lease }) {
  const instructions = usePaymentInstructions(lease.id);
  return (
    <Card>
      <CardHeader>
        <CardTitle>How this tenant pays</CardTitle>
        <CardDescription>What the tenant sees as payment instructions.</CardDescription>
      </CardHeader>
      <CardContent>
        {instructions.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : !instructions.data || instructions.data.methods.length === 0 ? (
          <p className="text-sm text-muted-foreground">No payment methods set up. Add them under Payment settings.</p>
        ) : (
          <ul className="space-y-3 text-sm">
            {instructions.data.methods.map((m) => (
              <li key={m.id}>
                <p className="font-medium">{m.display_name}</p>
                {m.shortcode && (
                  <p className="text-muted-foreground">
                    {m.provider === "mpesa_till" ? "Till" : "Paybill"} <span className="font-mono text-foreground">{m.shortcode}</span>
                    {m.account_number_to_use && (
                      <>
                        {" "}· Account <span className="font-mono text-foreground">{m.account_number_to_use}</span>
                      </>
                    )}
                  </p>
                )}
                {m.provider === "bank" && (
                  <p className="text-muted-foreground">
                    {m.bank_name} · <span className="font-mono text-foreground">{m.account_number}</span> · Ref{" "}
                    <span className="font-mono text-foreground">{instructions.data.account_reference}</span>
                  </p>
                )}
                {m.instructions && <p className="text-xs text-muted-foreground">{m.instructions}</p>}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

