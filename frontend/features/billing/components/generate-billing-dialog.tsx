"use client";

import { Receipt } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { useOrganization } from "@/components/providers/organization-provider";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { usePreviewBilling, useRunBilling } from "@/features/billing/api";
import { INVOICE_KIND } from "@/lib/labels";
import { formatMoney, todayIn } from "@/lib/utils";

/** Two steps: preview exactly what will be billed, then post it. */
export function GenerateBillingDialog() {
  const { current } = useOrganization();
  const currency = current.organization.currency;
  const [open, setOpen] = React.useState(false);
  const [period, setPeriod] = React.useState(todayIn(current.organization.timezone).slice(0, 7));
  const preview = usePreviewBilling();
  const runBilling = useRunBilling();

  const reset = () => {
    preview.reset();
    runBilling.reset();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Receipt /> Generate invoices
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Generate invoices</DialogTitle>
          <DialogDescription>
            Bills rent, enabled charges, new meter readings and shared costs for the month.
            Anything already billed is skipped, so running a month again only adds what&apos;s new.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-end gap-2">
          <div className="w-48">
            <FormField id="bill-period" label="Month">
              <Input
                type="month"
                value={period}
                onChange={(e) => {
                  setPeriod(e.target.value);
                  reset();
                }}
              />
            </FormField>
          </div>
          <Button variant="outline" loading={preview.isPending} disabled={!period} onClick={() => preview.mutate(period)}>
            Preview
          </Button>
        </div>

        {preview.isError && <Alert variant="error" title={preview.error.message} />}
        {runBilling.isError && <Alert variant="error" title={runBilling.error.message} />}
        {preview.data && (
          <div className="space-y-3">
            {preview.data.notes.map((note) => (
              <Alert key={note} title={note} />
            ))}
            {preview.data.invoice_count === 0 ? (
              <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
                Nothing new to bill for this month.
              </p>
            ) : (
              <>
                <p className="text-sm">
                  <strong>{preview.data.invoice_count}</strong> invoice
                  {preview.data.invoice_count === 1 ? "" : "s"} totalling{" "}
                  <strong>{formatMoney(preview.data.total, currency)}</strong>
                </p>
                <ul className="max-h-80 divide-y overflow-y-auto rounded-lg border">
                  {preview.data.invoices.map((inv) => (
                    <li key={`${inv.lease}-${inv.kind}`} className="px-4 py-3 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">
                            {inv.tenant_name} · {inv.property_name} {inv.unit_number}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {inv.lease_reference} · due {inv.due_date}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-medium">{formatMoney(inv.total, currency)}</p>
                          {inv.kind !== "regular" && <Badge variant="outline">{INVOICE_KIND[inv.kind]}</Badge>}
                        </div>
                      </div>
                      <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                        {inv.lines.map((line) => (
                          <li key={line.description} className="flex justify-between gap-2">
                            <span>{line.description}</span>
                            <span>{formatMoney(line.amount, currency)}</span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Close
          </Button>
          <Button
            disabled={!preview.data || preview.data.invoice_count === 0}
            loading={runBilling.isPending}
            onClick={() =>
              runBilling.mutate(period, {
                onSuccess: (run) => {
                  toast.success(
                    run.invoices_created
                      ? `${run.invoices_created} invoices posted (${formatMoney(run.total_billed, currency)})`
                      : "Nothing new to bill",
                  );
                  setOpen(false);
                  reset();
                },
              })
            }
          >
            Post invoices
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
