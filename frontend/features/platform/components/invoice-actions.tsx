"use client";

import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input, NativeSelect } from "@/components/ui/input";
import { useInvoiceAction } from "@/features/platform/api";
import { errorMessage } from "@/lib/api/errors";
import { formatMoney } from "@/lib/utils";
import type { SubscriptionInvoice } from "@/types/api";

/** Record a paybill/bank payment against a Nexora invoice, or void it. Only open invoices have actions. */
export function InvoiceActions({ invoice }: { invoice: SubscriptionInvoice }) {
  const [mode, setMode] = React.useState<"pay" | "void" | null>(null);
  if (invoice.status !== "open") return null;
  return (
    <div className="flex justify-end gap-1">
      <Button size="sm" variant="outline" onClick={() => setMode("pay")}>Record payment</Button>
      <Button size="sm" variant="ghost" onClick={() => setMode("void")}>Void</Button>
      {mode && <ActionDialog invoice={invoice} mode={mode} onClose={() => setMode(null)} />}
    </div>
  );
}

function ActionDialog({ invoice, mode, onClose }: { invoice: SubscriptionInvoice; mode: "pay" | "void"; onClose: () => void }) {
  const action = useInvoiceAction();
  const [method, setMethod] = React.useState("mpesa");
  const [text, setText] = React.useState("");
  const pay = mode === "pay";
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    action.mutate(
      pay
        ? { id: invoice.id, action: "record-payment", body: { method, reference: text.trim() } }
        : { id: invoice.id, action: "void", body: { reason: text.trim() } },
      {
        onSuccess: () => { toast.success(pay ? `${invoice.number} marked paid` : `${invoice.number} voided`); onClose(); },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{pay ? "Record payment" : "Void invoice"} {invoice.number}</DialogTitle>
            <DialogDescription>
              {formatMoney(invoice.amount, invoice.currency)} for the {invoice.plan_name} plan.{" "}
              {pay ? "Recording it extends the organization's access to the end of the invoiced month." : "Voided invoices can't be paid; issue a new one if needed."}
            </DialogDescription>
          </DialogHeader>
          {pay && (
            <FormField id="pay-method" label="Paid by">
              <NativeSelect value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="mpesa">M-Pesa paybill</option>
                <option value="bank">Bank transfer</option>
                <option value="other">Other</option>
              </NativeSelect>
            </FormField>
          )}
          <FormField id="pay-text" label={pay ? "Reference (M-Pesa code or bank reference)" : "Reason"}>
            <Input value={text} onChange={(e) => setText(e.target.value)} required={!pay} maxLength={pay ? 64 : 255} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant={pay ? "default" : "destructive"} loading={action.isPending}>{pay ? "Mark paid" : "Void invoice"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export const INVOICE_STATUS = {
  open: { label: "Unpaid", variant: "warning" },
  paid: { label: "Paid", variant: "accent" },
  void: { label: "Void", variant: "muted" },
} as const;
