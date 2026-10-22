"use client";

import { FileWarning, Receipt, Search, Trash2, Wallet, Zap } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/page-header";
import { useOrganization } from "@/components/providers/organization-provider";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
import {
  useBillingRuns,
  useBillingSummary,
  useChargeTypes,
  useCreateSharedCost,
  useDeleteSharedCost,
  useInvoices,
  useSharedCosts,
} from "@/features/billing/api";
import { usePropertyOptions } from "@/features/properties/api";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { errorMessage } from "@/lib/api/errors";
import { INVOICE_KIND } from "@/lib/labels";
import { formatDateTime, formatDay, formatMoney, formatMonth, plural } from "@/lib/utils";

import { GenerateBillingDialog } from "./generate-billing-dialog";
import { InvoiceStatusBadge } from "./invoice-status";

type Filter = "outstanding" | "overdue" | "all" | "void";

export function BillingPage() {
  const { can, current } = useOrganization();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = params.get("tab") ?? "invoices";
  const allowed = can("billing.view");
  const summary = useBillingSummary(allowed);
  const currency = current.organization.currency;
  const canGenerate = can("billing.generate") && (current.role === "owner" || current.access_scope === "organization");

  if (!allowed) return <Alert variant="error" title="You don't have permission to view billing." />;

  return (
    <>
      <PageHeader
        title="Billing"
        description="Invoices, tenant balances and monthly billing runs."
        actions={canGenerate && <GenerateBillingDialog />}
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat
          icon={Receipt}
          label="Billed this month"
          value={formatMoney(summary.data?.billed_this_month ?? 0, currency)}
          loading={summary.isPending}
        />
        <Stat
          icon={Wallet}
          label="Outstanding"
          value={formatMoney(summary.data?.outstanding ?? 0, currency)}
          hint={summary.data ? `${plural(summary.data.outstanding_invoices, "open invoice")}` : undefined}
          loading={summary.isPending}
        />
        <Stat
          icon={FileWarning}
          label="Overdue"
          value={formatMoney(summary.data?.overdue ?? 0, currency)}
          hint={summary.data ? `${plural(summary.data.overdue_invoices, "invoice")} past due` : undefined}
          loading={summary.isPending}
        />
      </div>
      <Tabs value={tab} onValueChange={(v) => router.replace(v === "invoices" ? pathname : `${pathname}?tab=${v}`)}>
        <TabsList className="mb-4">
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
          <TabsTrigger value="runs">Billing runs</TabsTrigger>
          <TabsTrigger value="shared">Shared costs</TabsTrigger>
        </TabsList>
        <TabsContent value="invoices">
          <InvoicesTable />
        </TabsContent>
        <TabsContent value="runs">
          <RunsTable />
        </TabsContent>
        <TabsContent value="shared">
          <SharedCosts />
        </TabsContent>
      </Tabs>
    </>
  );
}

function InvoicesTable() {
  const { current } = useOrganization();
  const [filter, setFilter] = React.useState<Filter>("outstanding");
  const [property, setProperty] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [page, setPage] = React.useState(1);
  const debounced = useDebouncedValue(search, 300);
  const properties = usePropertyOptions();
  const invoices = useInvoices({
    search: debounced,
    property,
    page,
    outstanding: filter === "outstanding" || undefined,
    overdue: filter === "overdue" || undefined,
    status: filter === "void" ? "void" : filter === "all" ? "" : "issued",
  });
  const tz = current.organization.timezone;
  const currency = current.organization.currency;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            aria-label="Search invoices"
            placeholder="Search by number, tenant or unit"
            className="pl-9"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <NativeSelect aria-label="Filter by property" className="md:w-56" value={property} onChange={(e) => { setProperty(e.target.value); setPage(1); }}>
          <option value="">All properties</option>
          {properties.data?.results.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="Filter invoices" className="md:w-48" value={filter} onChange={(e) => { setFilter(e.target.value as Filter); setPage(1); }}>
          <option value="outstanding">Outstanding</option>
          <option value="overdue">Overdue</option>
          <option value="all">All</option>
          <option value="void">Void</option>
        </NativeSelect>
      </div>
      {invoices.isPending ? (
        <Skeleton className="h-80 w-full" />
      ) : invoices.isError ? (
        <ErrorState message={errorMessage(invoices.error)} onRetry={() => invoices.refetch()} />
      ) : invoices.data.results.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title={filter === "outstanding" ? "Nothing outstanding" : "No invoices found"}
          description={
            filter === "outstanding" ? "Every issued invoice is settled, or none have been generated yet." : "Try a different filter."
          }
        />
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead className="hidden md:table-cell">Tenant</TableHead>
                <TableHead className="hidden lg:table-cell">Due</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Due now</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.data.results.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell>
                    <Link href={`/dashboard/billing/invoices/${inv.id}`} className="font-medium hover:underline">
                      {inv.number}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {inv.period_start ? formatMonth(inv.period_start) : INVOICE_KIND[inv.kind]}
                      {inv.kind === "supplementary" && " · supplementary"}
                    </p>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {inv.tenant_name}
                    <p className="text-xs text-muted-foreground">
                      {inv.property_name} · {inv.unit_number}
                    </p>
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap lg:table-cell">{formatDay(inv.due_date)}</TableCell>
                  <TableCell className="text-right">{formatMoney(inv.total, currency)}</TableCell>
                  <TableCell className="text-right font-medium">{formatMoney(inv.amount_due, currency)}</TableCell>
                  <TableCell>
                    <InvoiceStatusBadge invoice={inv} timeZone={tz} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {invoices.data && <Pagination page={page} pageSize={25} count={invoices.data.count} onPageChange={setPage} />}
    </div>
  );
}

function RunsTable() {
  const { current } = useOrganization();
  const [page, setPage] = React.useState(1);
  const runs = useBillingRuns(page);
  const currency = current.organization.currency;
  if (runs.isPending) return <Skeleton className="h-48 w-full" />;
  if (runs.isError) return <ErrorState message={errorMessage(runs.error)} onRetry={() => runs.refetch()} />;
  if (runs.data.results.length === 0) {
    return <EmptyState icon={Receipt} title="No billing runs yet" description="Generate invoices for a month to see runs here." />;
  }
  return (
    <>
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Month</TableHead>
              <TableHead className="hidden sm:table-cell">Run</TableHead>
              <TableHead className="text-right">Invoices</TableHead>
              <TableHead className="text-right">Billed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.data.results.map((run) => (
              <TableRow key={run.id}>
                <TableCell>
                  <p className="font-medium">{formatMonth(run.period)}</p>
                  {run.skipped.map((note) => (
                    <p key={note} className="text-xs text-warning-strong">
                      {note}
                    </p>
                  ))}
                </TableCell>
                <TableCell className="hidden text-muted-foreground sm:table-cell">
                  {formatDateTime(run.created_at, current.organization.timezone)} ·{" "}
                  {run.trigger === "scheduled" ? "Scheduled" : run.created_by_name || "Manual"}
                </TableCell>
                <TableCell className="text-right">{run.invoices_created}</TableCell>
                <TableCell className="text-right">{formatMoney(run.total_billed, currency)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Pagination page={page} pageSize={25} count={runs.data.count} onPageChange={setPage} />
    </>
  );
}

function SharedCosts() {
  const { can, current } = useOrganization();
  const [page, setPage] = React.useState(1);
  const costs = useSharedCosts(page);
  const remove = useDeleteSharedCost();
  const [adding, setAdding] = React.useState(false);
  const [deleting, setDeleting] = React.useState<string | null>(null);
  const currency = current.organization.currency;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Enter a bill for a whole property (e.g. common-area electricity). It&apos;s split evenly
          between occupied units whose charge rule uses the <em>shared</em> method when you
          generate that month&apos;s invoices.
        </p>
        {can("billing.generate") && <Button onClick={() => setAdding(true)}>Add shared cost</Button>}
      </div>
      {costs.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : costs.isError ? (
        <ErrorState message={errorMessage(costs.error)} />
      ) : costs.data.results.length === 0 ? (
        <EmptyState icon={Zap} title="No shared costs" description="Shared bills you enter will appear here." />
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cost</TableHead>
                <TableHead className="hidden sm:table-cell">Month</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Allocation</TableHead>
                {can("billing.generate") && <TableHead className="w-12" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {costs.data.results.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <p className="font-medium">{c.charge_type_name}</p>
                    <p className="text-xs text-muted-foreground">{c.property_name}{c.description && ` · ${c.description}`}</p>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{formatMonth(c.period)}</TableCell>
                  <TableCell className="text-right">{formatMoney(c.total_amount, currency)}</TableCell>
                  <TableCell>
                    {c.allocated_units ? (
                      <Badge variant="accent">Billed to {c.allocated_units} units</Badge>
                    ) : (
                      <Badge variant="warning">Not billed yet</Badge>
                    )}
                  </TableCell>
                  {can("billing.generate") && (
                    <TableCell>
                      {c.allocated_units === 0 && (
                        <Button variant="ghost" size="icon" className="text-destructive" aria-label="Delete shared cost" onClick={() => setDeleting(c.id)}>
                          <Trash2 />
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {costs.data && <Pagination page={page} pageSize={25} count={costs.data.count} onPageChange={setPage} />}
      <SharedCostDialog open={adding} onOpenChange={setAdding} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete shared cost?"
        description="It hasn't been billed yet, so nothing else changes."
        confirmLabel="Delete"
        destructive
        loading={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting, {
            onSuccess: () => {
              toast.success("Shared cost deleted");
              setDeleting(null);
            },
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />
    </div>
  );
}

function SharedCostDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { current } = useOrganization();
  const properties = usePropertyOptions(open);
  const types = useChargeTypes();
  const create = useCreateSharedCost();
  const [form, setForm] = React.useState({ property: "", charge_type: "", month: "", total_amount: "", description: "" });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value });
  const valid = form.property && form.charge_type && form.month && /^\d+(\.\d{1,2})?$/.test(form.total_amount) && Number(form.total_amount) > 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) create.reset(); onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a shared cost</DialogTitle>
          <DialogDescription>Billed when you generate invoices for the chosen month.</DialogDescription>
        </DialogHeader>
        {create.isError && <Alert variant="error" title={create.error.message} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="sc-property" label="Property">
            <NativeSelect value={form.property} onChange={set("property")}>
              <option value="">Choose…</option>
              {properties.data?.results.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField id="sc-type" label="Charge">
            <NativeSelect value={form.charge_type} onChange={set("charge_type")}>
              <option value="">Choose…</option>
              {types.data?.filter((t) => t.code !== "rent" && t.is_active).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField id="sc-month" label="Month">
            <Input type="month" value={form.month} onChange={set("month")} />
          </FormField>
          <FormField id="sc-amount" label={`Total (${current.organization.currency})`}>
            <Input inputMode="decimal" value={form.total_amount} onChange={set("total_amount")} />
          </FormField>
        </div>
        <FormField id="sc-desc" label="Description (optional)">
          <Input placeholder="e.g. KPLC common areas, account 12345" value={form.description} onChange={set("description")} />
        </FormField>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!valid}
            loading={create.isPending}
            onClick={() =>
              create.mutate(
                {
                  property: form.property,
                  charge_type: form.charge_type,
                  period: `${form.month}-01`,
                  total_amount: form.total_amount,
                  description: form.description,
                },
                {
                  onSuccess: () => {
                    toast.success("Shared cost added");
                    setForm({ property: "", charge_type: "", month: "", total_amount: "", description: "" });
                    onOpenChange(false);
                  },
                },
              )
            }
          >
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
