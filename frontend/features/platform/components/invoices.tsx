"use client";

import { Receipt } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePlatformInvoices } from "@/features/platform/api";
import { INVOICE_STATUS, InvoiceActions } from "@/features/platform/components/invoice-actions";
import { errorMessage } from "@/lib/api/errors";
import { formatDay, formatMoney } from "@/lib/utils";

export function PlatformInvoices() {
  const [status, setStatus] = React.useState("open");
  const invoices = usePlatformInvoices(status);
  return (
    <>
      <PageHeader title="Invoices" description="Nexora's invoices to organizations. Record paybill and bank payments here." />
      <Card>
        <CardContent className="pt-6">
          <NativeSelect aria-label="Invoice status" value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-48">
            <option value="open">Unpaid</option>
            <option value="paid">Paid</option>
            <option value="void">Void</option>
            <option value="">All</option>
          </NativeSelect>
        </CardContent>
        <CardContent className="px-0">
          {invoices.isPending ? (
            <div className="px-6"><Skeleton className="h-48 w-full" /></div>
          ) : invoices.isError ? (
            <div className="px-6"><ErrorState message={errorMessage(invoices.error)} onRetry={() => invoices.refetch()} /></div>
          ) : !invoices.data.length ? (
            <div className="px-6"><EmptyState icon={Receipt} title="No invoices" description="Nothing with this status." /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Organization</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.data.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="font-medium">{i.number}</TableCell>
                    <TableCell><Link className="hover:underline" href={`/platform/organizations/${i.organization.id}`}>{i.organization.name}</Link></TableCell>
                    <TableCell>{formatDay(i.period_start)} – {formatDay(i.period_end)}</TableCell>
                    <TableCell>{formatDay(i.due_date)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(i.amount, i.currency)}</TableCell>
                    <TableCell>
                      <Badge variant={INVOICE_STATUS[i.status].variant}>{INVOICE_STATUS[i.status].label}</Badge>
                      {i.payment_reference && <p className="text-xs text-muted-foreground">{i.payment_method} · {i.payment_reference}</p>}
                    </TableCell>
                    <TableCell><InvoiceActions invoice={i} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
