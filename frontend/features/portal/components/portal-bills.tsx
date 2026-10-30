"use client";

import { ArrowLeft, FileText, Printer, Receipt, Smartphone } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PdfDownloadButton } from "@/components/ui/pdf-download-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  usePortalInvoice,
  usePortalInvoices,
  usePortalPayments,
  usePortalReceipt,
  usePortalStatement,
  usePortalSummary,
} from "@/features/portal/api";
import { useTenancy } from "@/features/portal/tenancy";
import { ApiError, errorMessage } from "@/lib/api/errors";
import { INVOICE_KIND, PAYMENT_METHOD } from "@/lib/labels";
import { formatDay, formatMoney, formatMonth } from "@/lib/utils";
import type { InvoiceKind, PortalInvoice } from "@/types/api";

const TABS = ["bills", "receipts", "statement"] as const;
type Tab = (typeof TABS)[number];

export function PortalBills() {
  const router = useRouter();
  const params = useSearchParams();
  const tab = (TABS as readonly string[]).includes(params.get("tab") ?? "") ? (params.get("tab") as Tab) : "bills";
  return (
    <>
      <h1 className="mb-4 text-xl font-semibold tracking-tight">Bills &amp; receipts</h1>
      <Tabs value={tab} onValueChange={(v) => router.replace(v === "bills" ? "/portal/invoices" : `/portal/invoices?tab=${v}`, { scroll: false })}>
        <TabsList className="mb-4 grid w-full grid-cols-3">
          <TabsTrigger value="bills">Bills</TabsTrigger>
          <TabsTrigger value="receipts">Receipts</TabsTrigger>
          <TabsTrigger value="statement">Statement</TabsTrigger>
        </TabsList>
        <TabsContent value="bills"><BillsList /></TabsContent>
        <TabsContent value="receipts"><ReceiptsList /></TabsContent>
        <TabsContent value="statement"><Statement /></TabsContent>
      </Tabs>
    </>
  );
}

function invoiceTitle(i: PortalInvoice) {
  if (i.period_start) return formatMonth(i.period_start);
  return INVOICE_KIND[i.kind as InvoiceKind] ?? "Bill";
}

function BillsList() {
  const { tenantId, currency } = useTenancy();
  const invoices = usePortalInvoices(tenantId);
  if (invoices.isPending) return <Skeleton className="h-64 w-full" />;
  if (invoices.isError) return <ErrorState message={errorMessage(invoices.error)} onRetry={() => invoices.refetch()} />;
  if (invoices.data.length === 0) return <EmptyState icon={FileText} title="No bills yet" description="Your rent and other bills will appear here when they're issued." />;
  return (
    <ul className="divide-y rounded-xl border bg-card">
      {invoices.data.map((i) => {
        const due = Number(i.amount_due);
        return (
          <li key={i.id}>
            <Link href={`/portal/invoices/${i.id}`} className="flex items-center justify-between gap-3 p-4 hover:bg-muted/50">
              <span className="min-w-0">
                <span className="block font-medium">{invoiceTitle(i)}</span>
                <span className="block text-xs text-muted-foreground">{i.number} · due {formatDay(i.due_date)}</span>
              </span>
              <span className="text-right">
                <span className="block font-medium">{formatMoney(i.total, currency)}</span>
                {i.status === "void" ? <Badge variant="muted">Cancelled</Badge> : due > 0 ? <Badge variant="warning">{formatMoney(due, currency)} to pay</Badge> : <Badge variant="accent">Paid</Badge>}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function ReceiptsList() {
  const { tenantId, currency } = useTenancy();
  const payments = usePortalPayments(tenantId);
  if (payments.isPending) return <Skeleton className="h-64 w-full" />;
  if (payments.isError) return <ErrorState message={errorMessage(payments.error)} onRetry={() => payments.refetch()} />;
  if (payments.data.length === 0) return <EmptyState icon={Receipt} title="No receipts yet" description="Every payment you make gets a receipt here." />;
  return (
    <ul className="divide-y rounded-xl border bg-card">
      {payments.data.map((p) => (
        <li key={p.id}>
          <Link href={`/portal/payments/${p.id}`} className="flex items-center justify-between gap-3 p-4 hover:bg-muted/50">
            <span>
              <span className="block font-medium">{p.receipt_number}</span>
              <span className="block text-xs text-muted-foreground">{formatDay(p.received_on)} · {PAYMENT_METHOD[p.method as keyof typeof PAYMENT_METHOD] ?? p.method}</span>
            </span>
            <span className="text-right">
              <span className="block font-medium">{formatMoney(p.amount, currency)}</span>
              {p.status === "reversed" && <Badge variant="destructive">Reversed</Badge>}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Statement() {
  const { tenantId, currency } = useTenancy();
  const summary = usePortalSummary(tenantId);
  const [chosen, setChosen] = React.useState("");
  const leaseId = chosen || summary.data?.leases[0]?.id || "";
  const statement = usePortalStatement(tenantId, leaseId);
  if (summary.isPending) return <Skeleton className="h-64 w-full" />;
  if (summary.isError) return <ErrorState message={errorMessage(summary.error)} onRetry={() => summary.refetch()} />;
  if (summary.data.leases.length === 0) return <EmptyState icon={FileText} title="No statement yet" description="Your statement starts with your first lease." />;
  return (
    <div className="space-y-3">
      {summary.data.leases.length > 1 && (
        <NativeSelect aria-label="Lease" value={leaseId} onChange={(e) => setChosen(e.target.value)}>
          {summary.data.leases.map((l) => <option key={l.id} value={l.id}>{l.property_name} {l.unit_number} ({l.reference})</option>)}
        </NativeSelect>
      )}
      {statement.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : statement.isError ? (
        <ErrorState message={errorMessage(statement.error)} onRetry={() => statement.refetch()} />
      ) : (
        <Card>
          <CardContent className="pt-6">
            <p className="mb-3 flex justify-between text-sm font-medium">
              <span>Balance</span>
              <span>{formatMoney(statement.data.balance, currency)}</span>
            </p>
            <ul className="divide-y text-sm">
              {[...statement.data.entries].reverse().map((e, n) => (
                <li key={`${e.date}-${e.reference}-${n}`} className="flex items-start justify-between gap-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block">{e.description}</span>
                    <span className="block text-xs text-muted-foreground">{formatDay(e.date)}{e.reference && ` · ${e.reference}`}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className={`block font-medium ${Number(e.amount) < 0 ? "text-accent-strong" : ""}`}>{formatMoney(e.amount, currency)}</span>
                    <span className="block text-xs text-muted-foreground">bal. {formatMoney(e.balance, currency)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground print:hidden">
      <ArrowLeft className="size-4" /> {label}
    </Link>
  );
}

function notFound(error: unknown, what: string) {
  return error instanceof ApiError && error.status === 404 ? `This ${what} doesn't exist or isn't yours.` : errorMessage(error);
}

export function PortalInvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const { tenantId, currency, tenancy } = useTenancy();
  const invoice = usePortalInvoice(tenantId, id);
  if (invoice.isPending) return <Skeleton className="h-96 w-full" />;
  if (invoice.isError) return <ErrorState message={notFound(invoice.error, "bill")} />;
  const i = invoice.data;
  const due = Number(i.amount_due);
  return (
    <>
      <BackLink href="/portal/invoices" label="Bills" />
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            {invoiceTitle(i)}
            {i.status === "void" ? <Badge variant="muted">Cancelled</Badge> : due > 0 ? <Badge variant="warning">Unpaid</Badge> : <Badge variant="accent">Paid</Badge>}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {i.number} · {tenancy.organization.name} · {i.property_name} unit {i.unit_number}
          </p>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <dl className="grid grid-cols-2 gap-3">
            <div><dt className="text-xs text-muted-foreground">Issued</dt><dd>{formatDay(i.issue_date)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Due</dt><dd>{formatDay(i.due_date)}</dd></div>
            {i.period_start && <div className="col-span-2"><dt className="text-xs text-muted-foreground">Period</dt><dd>{formatDay(i.period_start)} – {formatDay(i.period_end)}</dd></div>}
          </dl>
          <ul className="divide-y rounded-lg border">
            {(i.lines ?? []).map((line, n) => (
              <li key={n} className="flex justify-between gap-3 px-3 py-2">
                <span>{line.description}</span>
                <span>{formatMoney(line.amount, currency)}</span>
              </li>
            ))}
            <li className="flex justify-between gap-3 px-3 py-2 font-semibold"><span>Total</span><span>{formatMoney(i.total, currency)}</span></li>
            {i.status !== "void" && <li className="flex justify-between gap-3 px-3 py-2 font-semibold"><span>Still to pay</span><span>{formatMoney(i.amount_due, currency)}</span></li>}
          </ul>
          <div className="flex flex-col gap-2 sm:flex-row print:hidden">
            {due > 0 && <Button asChild><Link href={`/portal/pay?amount=${Math.ceil(due)}`}><Smartphone /> Pay {formatMoney(due, currency)}</Link></Button>}
            <PdfDownloadButton path={`/portal/tenancies/${tenantId}/invoices/${i.id}/pdf/`} filename={`${i.number}.pdf`} scoped={false} />
            <Button variant="outline" onClick={() => window.print()}><Printer /> Print</Button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

export function PortalReceiptView() {
  const { id } = useParams<{ id: string }>();
  const { tenantId } = useTenancy();
  const receipt = usePortalReceipt(tenantId, id);
  if (receipt.isPending) return <Skeleton className="h-96 w-full" />;
  if (receipt.isError) return <ErrorState message={notFound(receipt.error, "receipt")} />;
  const r = receipt.data;
  const currency = r.organization.currency;
  return (
    <>
      <BackLink href="/portal/invoices?tab=receipts" label="Receipts" />
      <Card>
        <CardContent className="space-y-4 pt-6 text-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold tracking-widest text-muted-foreground">RECEIPT</p>
              <p className="text-lg font-semibold">{r.receipt_number}</p>
            </div>
            {r.status === "reversed" && <Badge variant="destructive">Reversed</Badge>}
          </div>
          <div>
            <p className="font-medium">{r.organization.name}</p>
            <p className="text-muted-foreground">{[r.organization.address, r.organization.phone, r.organization.email].filter(Boolean).join(" · ")}</p>
          </div>
          <dl className="grid grid-cols-2 gap-3">
            <div><dt className="text-xs text-muted-foreground">Received from</dt><dd>{r.tenant_name}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Date</dt><dd>{formatDay(r.received_on)}</dd></div>
            {r.property_name && <div><dt className="text-xs text-muted-foreground">For</dt><dd>{r.property_name} unit {r.unit_number}</dd></div>}
            <div><dt className="text-xs text-muted-foreground">Paid via</dt><dd>{PAYMENT_METHOD[r.method as keyof typeof PAYMENT_METHOD] ?? r.method}{r.reference && ` · ${r.reference}`}</dd></div>
          </dl>
          <p className="flex justify-between rounded-lg bg-muted/60 px-3 py-3 text-base font-semibold">
            <span>Amount</span><span>{formatMoney(r.amount, currency)}</span>
          </p>
          {r.invoices.length > 0 && (
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Applied to</p>
              <ul className="divide-y rounded-lg border">
                {r.invoices.map((inv) => (
                  <li key={inv.number} className="flex justify-between px-3 py-2"><span>{inv.number}</span><span>{formatMoney(inv.amount, currency)}</span></li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-col gap-2 sm:flex-row print:hidden">
            <PdfDownloadButton path={`/portal/tenancies/${tenantId}/payments/${r.id}/pdf/`} filename={`${r.receipt_number}.pdf`} scoped={false} />
            <Button variant="outline" onClick={() => window.print()}><Printer /> Print</Button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
