"use client";

import { Ban, CalendarDays, Pencil, PieChart, Plus, ReceiptText, Search } from "lucide-react";
import Link from "next/link";
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
import { Textarea } from "@/components/ui/textarea";
import { useExpenses, useExpenseSummary, useSaveExpense, useVoidExpense, type ExpenseListParams } from "@/features/expenses/api";
import { usePropertyOptions, useUnits } from "@/features/properties/api";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { ApiError, errorMessage } from "@/lib/api/errors";
import { EXPENSE_CATEGORY, PAYMENT_METHOD } from "@/lib/labels";
import { formatDay, formatMoney, todayIn } from "@/lib/utils";
import type { Expense, ExpenseCategory, ExpenseInput, ExpenseStatus, PaymentMethod } from "@/types/api";

/** Property filter value for costs that aren't tied to a property. */
const ORG_WIDE = "organization";

function monthBounds(today: string) {
  const [y, m] = today.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${today.slice(0, 7)}-01`, end: `${today.slice(0, 7)}-${String(last).padStart(2, "0")}` };
}

export function ExpensesPage() {
  const { can, current } = useOrganization();
  const allowed = can("expenses.view");
  const currency = current.organization.currency;
  const today = todayIn(current.organization.timezone);
  const month = monthBounds(today);
  const thisMonth = useExpenseSummary(month, allowed);
  const thisYear = useExpenseSummary({ start: `${today.slice(0, 4)}-01-01`, end: `${today.slice(0, 4)}-12-31` }, allowed);
  const [editing, setEditing] = React.useState<Expense | "new" | null>(null);
  const [voiding, setVoiding] = React.useState<Expense | null>(null);

  if (!allowed) return <Alert variant="error" title="You don't have permission to view expenses." />;
  const top = thisMonth.data?.by_category[0];

  return (
    <>
      <PageHeader
        title="Expenses"
        description="Running costs: utility bills, guards, salaries, land rates and the rest. Repairs are recorded on maintenance requests."
        actions={
          can("expenses.record") && (
            <Button onClick={() => setEditing("new")}>
              <Plus /> Record expense
            </Button>
          )
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat
          icon={ReceiptText}
          label="Spent this month"
          value={formatMoney(thisMonth.data?.total ?? 0, currency)}
          loading={thisMonth.isPending}
        />
        <Stat
          icon={CalendarDays}
          label={`Spent in ${today.slice(0, 4)}`}
          value={formatMoney(thisYear.data?.total ?? 0, currency)}
          loading={thisYear.isPending}
        />
        <Stat
          icon={PieChart}
          label="Largest this month"
          value={top ? top.label : "—"}
          hint={top ? formatMoney(top.total, currency) : undefined}
          loading={thisMonth.isPending}
        />
      </div>
      <ExpensesTable onEdit={setEditing} onVoid={setVoiding} />
      {can("reports.view") && (
        <p className="mt-6 text-sm text-muted-foreground">
          For totals by category and property over any period, including repairs, see the{" "}
          <Link href="/dashboard/reports?report=expenses" className="text-primary underline underline-offset-2">
            Expenses report
          </Link>
          .
        </p>
      )}
      <ExpenseDialog expense={editing} onClose={() => setEditing(null)} />
      <VoidDialog expense={voiding} onClose={() => setVoiding(null)} />
    </>
  );
}

function ExpensesTable({ onEdit, onVoid }: { onEdit: (e: Expense) => void; onVoid: (e: Expense) => void }) {
  const { can, current } = useOrganization();
  const orgWide = current.role === "owner" || current.access_scope === "organization";
  const currency = current.organization.currency;
  const properties = usePropertyOptions();
  const [search, setSearch] = React.useState("");
  const [property, setProperty] = React.useState("");
  const [category, setCategory] = React.useState<ExpenseCategory | "">("");
  const [status, setStatus] = React.useState<ExpenseStatus | "">("recorded");
  const [start, setStart] = React.useState("");
  const [end, setEnd] = React.useState("");
  const [page, setPage] = React.useState(1);
  const debounced = useDebouncedValue(search, 300);
  const params: ExpenseListParams = {
    search: debounced,
    category,
    status,
    start,
    end,
    page,
    ...(property === ORG_WIDE ? { organization_wide: true } : { property }),
  };
  const expenses = useExpenses(params);
  const filtered = Boolean(debounced || property || category || start || end || status !== "recorded");
  const filter = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        <div className="relative sm:col-span-2">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            aria-label="Search expenses"
            placeholder="Search description, supplier or reference"
            className="pl-9"
            value={search}
            onChange={(e) => filter(setSearch)(e.target.value)}
          />
        </div>
        <NativeSelect aria-label="Property" value={property} onChange={(e) => filter(setProperty)(e.target.value)}>
          <option value="">All properties</option>
          {orgWide && <option value={ORG_WIDE}>Organization-wide only</option>}
          {properties.data?.results.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="Category" value={category} onChange={(e) => filter(setCategory)(e.target.value as ExpenseCategory | "")}>
          <option value="">All categories</option>
          {Object.entries(EXPENSE_CATEGORY).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </NativeSelect>
        <Input type="date" aria-label="From" value={start} onChange={(e) => filter(setStart)(e.target.value)} />
        <Input type="date" aria-label="To" value={end} min={start || undefined} onChange={(e) => filter(setEnd)(e.target.value)} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <NativeSelect aria-label="Status" className="w-auto" value={status} onChange={(e) => filter(setStatus)(e.target.value as ExpenseStatus | "")}>
          <option value="recorded">Recorded</option>
          <option value="voided">Voided</option>
          <option value="">Recorded and voided</option>
        </NativeSelect>
        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch("");
              setProperty("");
              setCategory("");
              setStatus("recorded");
              setStart("");
              setEnd("");
              setPage(1);
            }}
          >
            Clear filters
          </Button>
        )}
      </div>
      {expenses.isPending ? (
        <Skeleton className="h-72 w-full" />
      ) : expenses.isError ? (
        <ErrorState message={errorMessage(expenses.error)} onRetry={() => expenses.refetch()} />
      ) : expenses.data.results.length === 0 ? (
        <EmptyState
          icon={ReceiptText}
          title={filtered ? "No expenses match" : "No expenses yet"}
          description={filtered ? "Try other filters." : "Record utility bills, guards' wages, land rates and other running costs to see what each property really earns."}
        />
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Expense</TableHead>
                <TableHead className="hidden md:table-cell">Property</TableHead>
                <TableHead className="hidden lg:table-cell">Category</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {expenses.data.results.map((e) => {
                const voided = e.status === "voided";
                return (
                  <TableRow key={e.id}>
                    <TableCell>
                      <p className={voided ? "font-medium text-muted-foreground line-through" : "font-medium"}>{e.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDay(e.incurred_on)} · {e.reference}
                        {e.supplier_name && ` · ${e.supplier_name}`}
                      </p>
                      {voided && (
                        <p className="text-xs text-muted-foreground">
                          Voided{e.voided_by_name && ` by ${e.voided_by_name}`}: {e.void_reason}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {e.property_name ?? <span className="text-muted-foreground">Organization-wide</span>}
                      {e.unit_number && <p className="text-xs text-muted-foreground">Unit {e.unit_number}</p>}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">{EXPENSE_CATEGORY[e.category]}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(e.amount, currency)}
                      {e.method && (
                        <p className="text-xs text-muted-foreground">
                          {PAYMENT_METHOD[e.method as keyof typeof PAYMENT_METHOD]}
                          {e.payment_reference && ` · ${e.payment_reference}`}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {voided ? (
                        <Badge variant="muted">Voided</Badge>
                      ) : (
                        <div className="flex justify-end gap-1">
                          {can("expenses.record") && (
                            <Button size="icon" variant="ghost" aria-label={`Edit ${e.reference}`} onClick={() => onEdit(e)}>
                              <Pencil />
                            </Button>
                          )}
                          {can("expenses.void") && (
                            <Button size="icon" variant="ghost" className="text-destructive" aria-label={`Void ${e.reference}`} onClick={() => onVoid(e)}>
                              <Ban />
                            </Button>
                          )}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      {expenses.data && <Pagination page={page} pageSize={25} count={expenses.data.count} onPageChange={setPage} />}
    </div>
  );
}

function ExpenseDialog({ expense, onClose }: { expense: Expense | "new" | null; onClose: () => void }) {
  return (
    <Dialog open={expense !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        {expense !== null && <ExpenseForm key={expense === "new" ? "new" : expense.id} expense={expense === "new" ? null : expense} onDone={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function ExpenseForm({ expense, onDone }: { expense: Expense | null; onDone: () => void }) {
  const { current } = useOrganization();
  const orgWide = current.role === "owner" || current.access_scope === "organization";
  const currency = current.organization.currency;
  const today = todayIn(current.organization.timezone);
  const properties = usePropertyOptions();
  const save = useSaveExpense();
  const [form, setForm] = React.useState<ExpenseInput>(() => ({
    property: expense ? expense.property : null,
    unit: expense?.unit ?? null,
    category: expense?.category ?? "utilities",
    description: expense?.description ?? "",
    supplier_name: expense?.supplier_name ?? "",
    amount: expense ? String(Number(expense.amount)) : "",
    incurred_on: expense?.incurred_on ?? today,
    method: expense?.method ?? "mpesa",
    payment_reference: expense?.payment_reference ?? "",
    notes: expense?.notes ?? "",
  }));
  // Members who only see some properties must pick one; there's no organization-wide option.
  const chosenProperty = form.property ?? (orgWide ? null : properties.data?.results[0]?.id ?? null);
  const units = useUnits({ property: chosenProperty ?? undefined, page_size: 200 }, Boolean(chosenProperty));
  const set = <K extends keyof ExpenseInput>(key: K, value: ExpenseInput[K]) => setForm((f) => ({ ...f, [key]: value }));
  const amountOk = /^\d+(\.\d{1,2})?$/.test(form.amount) && Number(form.amount) > 0;
  const fieldError = (f: string) => (save.error instanceof ApiError ? save.error.fieldError(f) : undefined);
  const fieldErrors = ["amount", "description", "incurred_on", "property", "unit"].some((f) => fieldError(f));

  return (
    <>
      <DialogHeader>
        <DialogTitle>{expense ? `Edit ${expense.reference}` : "Record an expense"}</DialogTitle>
        <DialogDescription>
          {expense
            ? "Changes are kept in the audit log. To remove an expense entered by mistake, void it instead."
            : "Money spent on running your properties. It counts in the financial reports from the date it was incurred."}
        </DialogDescription>
      </DialogHeader>
      {save.isError && !fieldErrors && <Alert variant="error" title={save.error.message} />}
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="exp-property" label="Property" error={fieldError("property")} hint={chosenProperty ? undefined : "Office rent, accountant's fees and other shared costs"}>
            <NativeSelect
              value={chosenProperty ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, property: e.target.value || null, unit: null }))}
            >
              {orgWide && <option value="">Organization-wide (no property)</option>}
              {properties.data?.results.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField id="exp-unit" label="Unit (optional)" error={fieldError("unit")}>
            <NativeSelect disabled={!chosenProperty} value={form.unit ?? ""} onChange={(e) => set("unit", e.target.value || null)}>
              <option value="">Whole property</option>
              {units.data?.results.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.number}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField id="exp-category" label="Category">
            <NativeSelect value={form.category} onChange={(e) => set("category", e.target.value as ExpenseCategory)}>
              {Object.entries(EXPENSE_CATEGORY).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField id="exp-date" label="Date incurred" error={fieldError("incurred_on")}>
            <Input type="date" max={today} value={form.incurred_on} onChange={(e) => set("incurred_on", e.target.value)} />
          </FormField>
        </div>
        <FormField id="exp-description" label="Description" error={fieldError("description")}>
          <Input maxLength={255} placeholder="e.g. Guards for October" value={form.description} onChange={(e) => set("description", e.target.value)} />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="exp-amount" label={`Amount (${currency})`} error={fieldError("amount")}>
            <Input inputMode="decimal" value={form.amount} onChange={(e) => set("amount", e.target.value)} />
          </FormField>
          <FormField id="exp-supplier" label="Paid to (optional)">
            <Input maxLength={150} value={form.supplier_name} onChange={(e) => set("supplier_name", e.target.value)} />
          </FormField>
          <FormField id="exp-method" label="Paid by">
            <NativeSelect value={form.method} onChange={(e) => set("method", e.target.value as PaymentMethod)}>
              {Object.entries(PAYMENT_METHOD).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
              <option value="">Not recorded</option>
            </NativeSelect>
          </FormField>
          <FormField id="exp-ref" label="Receipt or transaction code (optional)">
            <Input maxLength={64} className="uppercase" value={form.payment_reference} onChange={(e) => set("payment_reference", e.target.value)} />
          </FormField>
        </div>
        <FormField id="exp-notes" label="Notes (optional)">
          <Textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </FormField>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button
          disabled={!amountOk || !form.description.trim() || !form.incurred_on || (!orgWide && !chosenProperty)}
          loading={save.isPending}
          onClick={() =>
            save.mutate(
              { id: expense?.id, input: { ...form, property: chosenProperty } },
              {
                onSuccess: (saved) => {
                  toast.success(expense ? `${saved.reference} updated` : `${saved.reference} recorded`);
                  onDone();
                },
              },
            )
          }
        >
          {expense ? "Save changes" : "Record expense"}
        </Button>
      </DialogFooter>
    </>
  );
}

function VoidDialog({ expense, onClose }: { expense: Expense | null; onClose: () => void }) {
  const { current } = useOrganization();
  const action = useVoidExpense();
  const [reason, setReason] = React.useState("");
  const close = () => {
    action.reset();
    setReason("");
    onClose();
  };
  return (
    <Dialog open={expense !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Void {expense?.reference}?</DialogTitle>
          <DialogDescription>
            {expense && `${expense.description}, ${formatMoney(expense.amount, current.organization.currency)}. `}
            For expenses entered twice or by mistake. It stops counting in reports but stays on record, and voiding is audited.
          </DialogDescription>
        </DialogHeader>
        {action.isError && <Alert variant="error" title={action.error.message} />}
        <FormField id="void-reason" label="Reason">
          <Input maxLength={255} value={reason} onChange={(e) => setReason(e.target.value)} />
        </FormField>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!reason.trim()}
            loading={action.isPending}
            onClick={() =>
              expense &&
              action.mutate(
                { id: expense.id, reason },
                {
                  onSuccess: () => {
                    toast.success(`${expense.reference} voided`);
                    close();
                  },
                },
              )
            }
          >
            Void expense
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
