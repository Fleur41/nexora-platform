"use client";

import { AlertTriangle, Banknote, Link2, Plus, Search, Smartphone, Upload, Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/page-header";
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
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input, NativeSelect } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat } from "@/components/ui/stat";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLeases } from "@/features/leases/api";
import {
  useImportStatement,
  usePaymentAction,
  usePaymentConfigurations,
  usePaymentRequests,
  usePayments,
  usePaymentsSummary,
  useStatementImports,
} from "@/features/payments/api";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { errorMessage } from "@/lib/api/errors";
import { PAYMENT_METHOD, PAYMENT_SOURCE } from "@/lib/labels";
import { formatDateTime, formatDay, formatMoney, plural } from "@/lib/utils";
import type { Payment } from "@/types/api";

import { RecordPaymentDialog } from "./record-payment-dialog";

export function PaymentsPage() {
  const { can, current } = useOrganization();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = params.get("tab") ?? "payments";
  const allowed = can("payments.view");
  const summary = usePaymentsSummary(allowed);
  const [recording, setRecording] = React.useState(false);
  const currency = current.organization.currency;
  const orgWide = current.role === "owner" || current.access_scope === "organization";

  if (!allowed) return <Alert variant="error" title="You don't have permission to view payments." />;

  return (
    <>
      <PageHeader
        title="Payments"
        description="Money received, receipts and reconciliation."
        actions={
          can("payments.record") && (
            <Button onClick={() => setRecording(true)}>
              <Plus /> Record payment
            </Button>
          )
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat icon={Banknote} label="Collected this month" value={formatMoney(summary.data?.collected_this_month ?? 0, currency)} loading={summary.isPending} />
        <Stat
          icon={AlertTriangle}
          label="Unmatched"
          value={formatMoney(summary.data?.unmatched_amount ?? 0, currency)}
          hint={summary.data ? `${plural(summary.data.unmatched_count, "payment")} to reconcile` : undefined}
          loading={summary.isPending}
          href={orgWide ? "/dashboard/payments?tab=unmatched" : undefined}
        />
        <Stat icon={Wallet} label="Credit held for tenants" value={formatMoney(summary.data?.credit_held ?? 0, currency)} hint="Overpayments not yet applied" loading={summary.isPending} />
      </div>
      <Tabs value={tab} onValueChange={(v) => router.replace(v === "payments" ? pathname : `${pathname}?tab=${v}`)}>
        <TabsList className="mb-4 h-auto flex-wrap">
          <TabsTrigger value="payments">Payments</TabsTrigger>
          {orgWide && <TabsTrigger value="unmatched">Unmatched{summary.data?.unmatched_count ? ` (${summary.data.unmatched_count})` : ""}</TabsTrigger>}
          <TabsTrigger value="requests">M-Pesa requests</TabsTrigger>
          {orgWide && <TabsTrigger value="imports">Bank imports</TabsTrigger>}
        </TabsList>
        <TabsContent value="payments">
          <PaymentsTable />
        </TabsContent>
        {orgWide && (
          <TabsContent value="unmatched">
            <PaymentsTable unmatched />
          </TabsContent>
        )}
        <TabsContent value="requests">
          <RequestsTable />
        </TabsContent>
        {orgWide && (
          <TabsContent value="imports">
            <ImportsPanel />
          </TabsContent>
        )}
      </Tabs>
      <RecordPaymentDialog open={recording} onOpenChange={setRecording} />
    </>
  );
}

function PaymentsTable({ unmatched = false }: { unmatched?: boolean }) {
  const { can, current } = useOrganization();
  const [search, setSearch] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [matching, setMatching] = React.useState<Payment | null>(null);
  const debounced = useDebouncedValue(search, 300);
  const payments = usePayments({ search: debounced, page, ...(unmatched ? { matched: false, status: "completed" } : {}) });
  const currency = current.organization.currency;

  return (
    <div className="space-y-4">
      {unmatched && (
        <p className="max-w-3xl text-sm text-muted-foreground">
          Payments whose account number didn&apos;t identify a tenant (e.g. a typo on M-Pesa) or
          bank credits without a lease reference. Match each one to the right lease; it&apos;s then
          applied to that tenant&apos;s invoices.
        </p>
      )}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          aria-label="Search payments"
          placeholder="Search receipt, code, payer or account"
          className="pl-9"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>
      {payments.isPending ? (
        <Skeleton className="h-72 w-full" />
      ) : payments.isError ? (
        <ErrorState message={errorMessage(payments.error)} onRetry={() => payments.refetch()} />
      ) : payments.data.results.length === 0 ? (
        <EmptyState
          icon={unmatched ? Link2 : Banknote}
          title={unmatched ? "Nothing to reconcile" : "No payments yet"}
          description={unmatched ? "Every payment is matched to a tenant." : "Record a payment, or connect M-Pesa under Payment settings."}
        />
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Receipt</TableHead>
                <TableHead className="hidden md:table-cell">{unmatched ? "Account entered" : "Tenant"}</TableHead>
                <TableHead className="hidden lg:table-cell">Method</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>{unmatched ? "" : "Status"}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.data.results.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link href={`/dashboard/payments/${p.id}`} className="font-medium hover:underline">
                      {p.receipt_number}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {formatDay(p.received_on)}
                      {p.reference && ` · ${p.reference}`}
                    </p>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {unmatched ? (
                      <>
                        {p.account_reference || "—"}
                        <p className="text-xs text-muted-foreground">{p.payer_name}</p>
                      </>
                    ) : (
                      <>
                        {p.tenant_name}
                        <p className="text-xs text-muted-foreground">
                          {p.property_name} {p.unit_number}
                        </p>
                      </>
                    )}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {PAYMENT_METHOD[p.method as keyof typeof PAYMENT_METHOD] ?? p.method}
                    <p className="text-xs text-muted-foreground">{PAYMENT_SOURCE[p.source]}</p>
                  </TableCell>
                  <TableCell className="text-right">
                    {formatMoney(p.amount, currency)}
                    {Number(p.unallocated) > 0 && p.is_matched && (
                      <p className="text-xs text-accent-strong">{formatMoney(p.unallocated, currency)} credit</p>
                    )}
                  </TableCell>
                  <TableCell>
                    {unmatched ? (
                      can("payments.record") && (
                        <Button size="sm" variant="outline" onClick={() => setMatching(p)}>
                          Match
                        </Button>
                      )
                    ) : p.status === "reversed" ? (
                      <Badge variant="muted">Reversed</Badge>
                    ) : !p.is_matched ? (
                      <Badge variant="warning">Unmatched</Badge>
                    ) : (
                      <Badge variant="accent">Received</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {payments.data && <Pagination page={page} pageSize={25} count={payments.data.count} onPageChange={setPage} />}
      <MatchDialog payment={matching} onClose={() => setMatching(null)} />
    </div>
  );
}

function MatchDialog({ payment, onClose }: { payment: Payment | null; onClose: () => void }) {
  const { current } = useOrganization();
  const [search, setSearch] = React.useState("");
  const debounced = useDebouncedValue(search, 300);
  const leases = useLeases({ search: debounced, page_size: 50 }, payment !== null);
  const action = usePaymentAction();
  const [lease, setLease] = React.useState("");
  const close = () => {
    setLease("");
    setSearch("");
    action.reset();
    onClose();
  };
  return (
    <Dialog open={payment !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Match {payment?.receipt_number}</DialogTitle>
          <DialogDescription>
            {payment && formatMoney(payment.amount, current.organization.currency)} received{" "}
            {payment && formatDay(payment.received_on)}
            {payment?.account_reference && ` with account “${payment.account_reference}”`}
            {payment?.payer_name && ` from ${payment.payer_name}`}.
          </DialogDescription>
        </DialogHeader>
        {action.isError && <Alert variant="error" title={action.error.message} />}
        <Input aria-label="Search leases" placeholder="Search tenant, unit or lease" value={search} onChange={(e) => setSearch(e.target.value)} />
        <NativeSelect aria-label="Lease" value={lease} onChange={(e) => setLease(e.target.value)}>
          <option value="">Choose the lease…</option>
          {leases.data?.results
            .filter((l) => l.status === "active" || l.status === "ended")
            .map((l) => (
              <option key={l.id} value={l.id}>
                {l.tenant_name} · {l.property_name} {l.unit_number} ({l.reference})
              </option>
            ))}
        </NativeSelect>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button
            disabled={!lease}
            loading={action.isPending}
            onClick={() =>
              payment &&
              action.mutate(
                { id: payment.id, action: "match", body: { lease } },
                {
                  onSuccess: () => {
                    toast.success("Payment matched and applied");
                    close();
                  },
                },
              )
            }
          >
            Match payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const REQUEST_STATUS = {
  pending: { label: "Waiting for tenant", variant: "warning" },
  completed: { label: "Paid", variant: "accent" },
  failed: { label: "Failed / cancelled", variant: "muted" },
  expired: { label: "Expired", variant: "muted" },
  needs_review: { label: "Needs review", variant: "destructive" },
} as const;

function RequestsTable() {
  const { current } = useOrganization();
  const [page, setPage] = React.useState(1);
  const requests = usePaymentRequests({ page });
  if (requests.isPending) return <Skeleton className="h-48 w-full" />;
  if (requests.isError) return <ErrorState message={errorMessage(requests.error)} />;
  if (requests.data.results.length === 0) {
    return (
      <EmptyState
        icon={Smartphone}
        title="No M-Pesa payment requests"
        description="With M-Pesa connected, you can send a payment prompt to a tenant's phone from their lease page."
      />
    );
  }
  return (
    <>
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tenant</TableHead>
              <TableHead className="hidden sm:table-cell">Sent</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {requests.data.results.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  {r.tenant_name}
                  <p className="text-xs text-muted-foreground">
                    {r.lease_reference} · {r.phone}
                  </p>
                </TableCell>
                <TableCell className="hidden text-muted-foreground sm:table-cell">{formatDateTime(r.created_at, current.organization.timezone)}</TableCell>
                <TableCell className="text-right">{formatMoney(r.amount, current.organization.currency)}</TableCell>
                <TableCell>
                  <Badge variant={REQUEST_STATUS[r.status].variant}>{REQUEST_STATUS[r.status].label}</Badge>
                  {r.payment && (
                    <Link href={`/dashboard/payments/${r.payment}`} className="ml-2 text-xs text-primary hover:underline">
                      {r.receipt_number}
                    </Link>
                  )}
                  {r.status === "needs_review" && <p className="text-xs text-muted-foreground">{r.result_description}</p>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Pagination page={page} pageSize={25} count={requests.data.count} onPageChange={setPage} />
    </>
  );
}

function ImportsPanel() {
  const { can, current } = useOrganization();
  const configs = usePaymentConfigurations();
  const banks = (configs.data ?? []).filter((c) => c.provider === "bank");
  const imports = useStatementImports();
  const upload = useImportStatement();
  const [config, setConfig] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const chosen = config || banks[0]?.id || "";

  return (
    <div className="space-y-6">
      {can("payments.record") && (
        <div className="rounded-xl border bg-card p-5">
          <h2 className="font-semibold">Import a bank statement</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Upload a CSV export with columns like <em>Date, Description, Reference, Credit</em>. Each
            credit becomes a payment, matched automatically when it mentions a lease reference (e.g.
            LSE-0007); the rest wait in Unmatched. Importing the same statement again adds nothing.
          </p>
          {banks.length === 0 ? (
            <Alert className="mt-4" title="Add a bank account under Payment settings first." />
          ) : (
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
              <FormField id="imp-config" label="Bank account">
                <NativeSelect value={chosen} onChange={(e) => setConfig(e.target.value)}>
                  {banks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.display_name} ({b.account_number})
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField id="imp-file" label="CSV file">
                <Input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </FormField>
              <Button
                disabled={!file || !chosen}
                loading={upload.isPending}
                onClick={() =>
                  file &&
                  upload.mutate(
                    { configuration: chosen, file },
                    {
                      onSuccess: (b) => toast.success(`${b.rows_created} payments imported (${b.rows_matched} matched, ${b.rows_duplicate} already imported)`),
                      onError: (e) => toast.error(errorMessage(e)),
                    },
                  )
                }
              >
                <Upload /> Import
              </Button>
            </div>
          )}
        </div>
      )}
      {imports.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : imports.data && imports.data.results.length > 0 ? (
        <ul className="divide-y rounded-xl border bg-card text-sm">
          {imports.data.results.map((b) => (
            <li key={b.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">
                  {b.file_name} <span className="font-normal text-muted-foreground">→ {b.configuration_name}</span>
                </p>
                <p className="text-muted-foreground">{formatDateTime(b.created_at, current.organization.timezone)}</p>
              </div>
              <p className="text-muted-foreground">
                {b.rows_created} imported · {b.rows_matched} matched · {b.rows_duplicate} duplicates · {b.rows_skipped} skipped
              </p>
              {b.errors.slice(0, 3).map((e) => (
                <p key={e} className="text-xs text-warning-strong">
                  {e}
                </p>
              ))}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
