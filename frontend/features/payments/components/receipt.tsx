"use client";

import { ArrowLeft, Printer } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { NexoraLogo } from "@/components/brand/logo";
import { useOrganization } from "@/components/providers/organization-provider";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PdfDownloadButton } from "@/components/ui/pdf-download-button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { useLeaseAccount } from "@/features/billing/api";
import { usePayment } from "@/features/payments/api";
import { errorMessage } from "@/lib/api/errors";
import { PAYMENT_METHOD } from "@/lib/labels";
import { formatDateTime, formatDay, formatMoney } from "@/lib/utils";

/** A printable receipt. Uses the browser's print dialog (Save as PDF works too). */
export function Receipt() {
  const { id } = useParams<{ id: string }>();
  const { current } = useOrganization();
  const payment = usePayment(id);
  const account = useLeaseAccount(payment.data?.lease ?? "", Boolean(payment.data?.lease));
  if (payment.isPending) return <Skeleton className="h-96 w-full" />;
  if (payment.isError) return <ErrorState message={errorMessage(payment.error)} />;
  const p = payment.data;
  const org = current.organization;

  return (
    <>
      <div className="mb-4 flex justify-between print:hidden">
        <Link href={`/dashboard/payments/${p.id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Payment
        </Link>
        <div className="flex gap-2">
          <PdfDownloadButton path={`/payments/${p.id}/pdf/`} filename={`${p.receipt_number}.pdf`} />
          <Button onClick={() => window.print()}>
            <Printer /> Print
          </Button>
        </div>
      </div>
      {p.status === "reversed" && <Alert variant="error" className="mb-4 print:hidden" title="This payment was reversed. The receipt is no longer valid." />}
      <article className="mx-auto max-w-2xl rounded-xl border bg-white p-8 text-sm text-[#0b1730] shadow-sm print:max-w-none print:border-0 print:p-0 print:shadow-none">
        <header className="flex items-start justify-between gap-6 border-b pb-6">
          <div>
            <p className="text-lg font-semibold">{org.legal_name || org.name}</p>
            {org.address && <p className="text-muted-foreground">{org.address}</p>}
            {(org.phone || org.email) && <p className="text-muted-foreground">{[org.phone, org.email].filter(Boolean).join(" · ")}</p>}
          </div>
          <div className="text-right">
            <p className="text-2xl font-semibold tracking-tight">RECEIPT</p>
            <p className="font-mono">{p.receipt_number}</p>
            {p.status === "reversed" && <p className="font-semibold text-destructive">REVERSED</p>}
          </div>
        </header>
        <section className="grid grid-cols-2 gap-6 py-6">
          <div>
            <p className="text-xs uppercase text-muted-foreground">Received from</p>
            <p className="font-medium">{p.tenant_name}</p>
            <p>
              {p.property_name} · Unit {p.unit_number}
            </p>
            <p className="text-muted-foreground">Lease {p.lease_reference}</p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase text-muted-foreground">Date received</p>
            <p className="font-medium">{formatDay(p.received_on)}</p>
            <p>{PAYMENT_METHOD[p.method as keyof typeof PAYMENT_METHOD]}{p.reference && ` · ${p.reference}`}</p>
          </div>
        </section>
        <table className="w-full border-t">
          <tbody>
            {p.allocations.filter((a) => !a.is_reversed).map((a) => (
              <tr key={a.id} className="border-b">
                <td className="py-2">Payment towards invoice {a.invoice_number}</td>
                <td className="py-2 text-right">{formatMoney(a.amount, org.currency)}</td>
              </tr>
            ))}
            {Number(p.unallocated) > 0 && (
              <tr className="border-b">
                <td className="py-2">Credit carried forward</td>
                <td className="py-2 text-right">{formatMoney(p.unallocated, org.currency)}</td>
              </tr>
            )}
            <tr className="font-semibold">
              <td className="py-3">Total received</td>
              <td className="py-3 text-right text-base">{formatMoney(p.amount, org.currency)}</td>
            </tr>
          </tbody>
        </table>
        {account.data && (
          <p className="mt-2 text-right text-muted-foreground">
            Account balance now: {Number(account.data.balance) < 0 ? `${formatMoney(-Number(account.data.balance), org.currency)} in credit` : formatMoney(account.data.balance, org.currency)}
          </p>
        )}
        <footer className="mt-10 flex items-end justify-between border-t pt-4 text-xs text-muted-foreground">
          <p>Issued {formatDateTime(p.created_at, org.timezone)}{p.created_by_name && ` by ${p.created_by_name}`}</p>
          <NexoraLogo className="scale-75 opacity-70" />
        </footer>
      </article>
    </>
  );
}
