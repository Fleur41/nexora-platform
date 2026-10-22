"use client";

import * as React from "react";
import { toast } from "sonner";

import { useOrganization } from "@/components/providers/organization-provider";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
import { useLeaseAccount } from "@/features/billing/api";
import { useLeases } from "@/features/leases/api";
import { usePaymentConfigurations, useRecordPayment } from "@/features/payments/api";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { ApiError } from "@/lib/api/errors";
import { formatMoney, todayIn } from "@/lib/utils";
import type { PaymentMethodKind } from "@/types/api";

const PROVIDER_ORDER = ["mpesa_paybill", "mpesa_till", "bank", "cash", "other"];

const MANUAL_METHODS: { value: PaymentMethodKind; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "cheque", label: "Cheque" },
  { value: "mpesa", label: "M-Pesa (other number)" },
  { value: "bank", label: "Bank (other account)" },
  { value: "other", label: "Other" },
];

/** Record money received. If `leaseId` is given the lease is fixed (lease page). */
export function RecordPaymentDialog({
  open,
  onOpenChange,
  leaseId,
  onRecorded,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  leaseId?: string;
  onRecorded?: (receipt: string, id: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        {open && <PaymentForm fixedLease={leaseId} onDone={() => onOpenChange(false)} onRecorded={onRecorded} />}
      </DialogContent>
    </Dialog>
  );
}

function PaymentForm({
  fixedLease,
  onDone,
  onRecorded,
}: {
  fixedLease?: string;
  onDone: () => void;
  onRecorded?: (receipt: string, id: string) => void;
}) {
  const { current } = useOrganization();
  const currency = current.organization.currency;
  const today = todayIn(current.organization.timezone);
  const configs = usePaymentConfigurations();
  const record = useRecordPayment();
  const [search, setSearch] = React.useState("");
  const debounced = useDebouncedValue(search, 300);
  const leases = useLeases({ search: debounced, status: "active", page_size: 50 }, !fixedLease);
  const [lease, setLease] = React.useState(fixedLease ?? "");
  const account = useLeaseAccount(lease, Boolean(lease));
  // M-Pesa first: it's how most rent is paid, so it's the sensible default.
  const enabled = (configs.data ?? [])
    .filter((c) => c.is_enabled)
    .sort((a, b) => PROVIDER_ORDER.indexOf(a.provider) - PROVIDER_ORDER.indexOf(b.provider));
  const [how, setHow] = React.useState<string>("");
  const [form, setForm] = React.useState({ amount: "", received_on: today, reference: "", payer_name: "", payer_phone: "", notes: "" });
  const choice = how || (enabled[0] ? `config:${enabled[0].id}` : "method:cash");
  const config = choice.startsWith("config:") ? enabled.find((c) => `config:${c.id}` === choice) : undefined;
  const method = config ? config.method : (choice.replace("method:", "") as PaymentMethodKind);
  const needsReference = method === "mpesa" || method === "bank";
  const amountOk = /^\d+(\.\d{1,2})?$/.test(form.amount) && Number(form.amount) > 0;
  const fieldError = (f: string) => (record.error instanceof ApiError ? record.error.fieldError(f) : undefined);
  const balance = account.data ? Number(account.data.balance) : null;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Record a payment</DialogTitle>
        <DialogDescription>
          Applied to the oldest unpaid invoices first. Anything extra is held as credit and used for
          the next invoices automatically. A receipt number is issued.
        </DialogDescription>
      </DialogHeader>
      {record.isError && !fieldError("reference") && !fieldError("amount") && <Alert variant="error" title={record.error.message} />}
      <div className="space-y-4">
        {!fixedLease && (
          <div className="grid gap-2 sm:grid-cols-2">
            <Input aria-label="Search leases" placeholder="Search tenant, unit or lease" value={search} onChange={(e) => setSearch(e.target.value)} />
            <NativeSelect aria-label="Lease" value={lease} onChange={(e) => setLease(e.target.value)}>
              <option value="">{leases.isPending ? "Loading…" : "Choose a lease"}</option>
              {leases.data?.results.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.tenant_name} · {l.property_name} {l.unit_number}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
        {balance !== null && (
          <p className="rounded-lg bg-muted p-3 text-sm">
            {balance > 0 ? (
              <>
                Balance owed: <strong>{formatMoney(balance, currency)}</strong>
              </>
            ) : balance < 0 ? (
              <>
                Tenant already has <strong>{formatMoney(-balance, currency)}</strong> in credit.
              </>
            ) : (
              "Nothing owed right now. This payment will be held as credit."
            )}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="pay-amount" label={`Amount (${currency})`} error={fieldError("amount")}>
            <Input inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </FormField>
          <FormField id="pay-date" label="Date received">
            <Input type="date" max={today} value={form.received_on} onChange={(e) => setForm({ ...form, received_on: e.target.value })} />
          </FormField>
          <FormField id="pay-how" label="Paid via">
            <NativeSelect value={choice} onChange={(e) => setHow(e.target.value)}>
              {enabled.length > 0 && (
                <optgroup label="Your payment methods">
                  {enabled.map((c) => (
                    <option key={c.id} value={`config:${c.id}`}>
                      {c.display_name}
                      {c.shortcode ? ` (${c.shortcode})` : c.account_number ? ` (${c.account_number})` : ""}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="Other">
                {MANUAL_METHODS.map((m) => (
                  <option key={m.value} value={`method:${m.value}`}>
                    {m.label}
                  </option>
                ))}
              </optgroup>
            </NativeSelect>
          </FormField>
          <FormField
            id="pay-ref"
            label={needsReference ? (method === "mpesa" ? "M-Pesa code" : "Bank reference") : "Reference (optional)"}
            error={fieldError("reference")}
          >
            <Input className="uppercase" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
          </FormField>
          <FormField id="pay-name" label="Paid by (optional)">
            <Input value={form.payer_name} onChange={(e) => setForm({ ...form, payer_name: e.target.value })} />
          </FormField>
          <FormField id="pay-phone" label="Payer phone (optional)">
            <Input type="tel" value={form.payer_phone} onChange={(e) => setForm({ ...form, payer_phone: e.target.value })} />
          </FormField>
        </div>
        <FormField id="pay-notes" label="Notes (optional)">
          <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </FormField>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button
          disabled={!lease || !amountOk || (needsReference && !form.reference.trim())}
          loading={record.isPending}
          onClick={() =>
            record.mutate(
              { lease, ...form, ...(config ? { configuration: config.id } : { method }) },
              {
                onSuccess: (payment) => {
                  toast.success(`Receipt ${payment.receipt_number} issued`);
                  onRecorded?.(payment.receipt_number, payment.id);
                  onDone();
                },
              },
            )
          }
        >
          Record payment
        </Button>
      </DialogFooter>
    </>
  );
}
