"use client";

import { CalendarX, Pencil, Plus, Settings2, Tags, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/page-header";
import { useOrganization } from "@/components/providers/organization-provider";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  useBillingSettings,
  useChargeRules,
  useChargeTypes,
  useDeleteChargeRule,
  useEndChargeRule,
  useSaveBillingSettings,
  useSaveChargeType,
} from "@/features/billing/api";
import { errorMessage } from "@/lib/api/errors";
import { RULE_METHOD } from "@/lib/labels";
import { formatDay, formatMoney } from "@/lib/utils";
import type { ChargeRule, IncomeCategory } from "@/types/api";

import { RuleDialog } from "./rule-dialog";

const INCOME: Record<IncomeCategory, string> = {
  rental_income: "Rental income",
  utility_recovery: "Utility recovery",
  service_charge: "Service charge",
  other_income: "Other income",
};

export function ChargesPage() {
  const { can } = useOrganization();
  if (!can("billing.view")) return <Alert variant="error" title="You don't have permission to view charges." />;
  return (
    <>
      <PageHeader
        title="Charges"
        description="What tenants are billed besides rent. Nothing is billed for a charge until you add an enabled rule for it."
      />
      <div className="space-y-6">
        <RulesCard />
        <div className="grid gap-6 lg:grid-cols-2">
          <ChargeTypesCard />
          <AutomationCard />
        </div>
      </div>
    </>
  );
}

function RulesCard() {
  const { can, current } = useOrganization();
  const [page, setPage] = React.useState(1);
  const [chargeType, setChargeType] = React.useState("");
  const rules = useChargeRules({ page, charge_type: chargeType || undefined });
  const types = useChargeTypes();
  const remove = useDeleteChargeRule();
  const [editing, setEditing] = React.useState<ChargeRule | "new" | null>(null);
  const [ending, setEnding] = React.useState<ChargeRule | null>(null);
  const [deleting, setDeleting] = React.useState<ChargeRule | null>(null);
  const canConfigure = can("billing.configure");
  const currency = current.organization.currency;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Charge rules</CardTitle>
          <CardDescription>
            Rules that have been billed can&apos;t be edited (past invoices keep their terms). End
            them and add a new rule from a later date.
          </CardDescription>
        </div>
        {canConfigure && (
          <Button onClick={() => setEditing("new")}>
            <Plus /> Add rule
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <NativeSelect aria-label="Filter by charge" className="sm:w-60" value={chargeType} onChange={(e) => { setChargeType(e.target.value); setPage(1); }}>
          <option value="">All charges</option>
          {types.data?.filter((t) => t.code !== "rent").map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </NativeSelect>
        {rules.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : rules.isError ? (
          <ErrorState message={errorMessage(rules.error)} onRetry={() => rules.refetch()} />
        ) : rules.data.results.length === 0 ? (
          <EmptyState
            icon={Tags}
            title="No charge rules yet"
            description="Tenants are billed rent only. Add a rule to bill security, garbage, water or anything else."
          />
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Charge</TableHead>
                  <TableHead>Applies to</TableHead>
                  <TableHead className="hidden md:table-cell">Billing</TableHead>
                  <TableHead className="hidden lg:table-cell">Dates</TableHead>
                  {canConfigure && <TableHead className="w-28"><span className="sr-only">Actions</span></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.data.results.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <p className="font-medium">{r.charge_type_name}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {!r.is_enabled && <Badge variant="muted">Off</Badge>}
                        {r.included_in_rent && <Badge variant="outline">Included in rent</Badge>}
                        {r.is_billed && <Badge variant="default">Billed</Badge>}
                      </div>
                    </TableCell>
                    <TableCell>{r.target_name}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      {RULE_METHOD[r.method]}
                      {r.method !== "shared" && (
                        <p className="text-xs text-muted-foreground">
                          {formatMoney(r.amount, currency)}
                          {r.method === "metered" ? ` per ${r.usage_unit || "unit"}` : r.method === "fixed_monthly" ? " / month" : ""}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap text-muted-foreground lg:table-cell">
                      {formatDay(r.effective_from)} – {r.effective_to ? formatDay(r.effective_to) : "ongoing"}
                    </TableCell>
                    {canConfigure && (
                      <TableCell className="text-right">
                        {!r.is_billed && (
                          <Button variant="ghost" size="icon" aria-label="Edit rule" onClick={() => setEditing(r)}>
                            <Pencil />
                          </Button>
                        )}
                        {!r.effective_to && (
                          <Button variant="ghost" size="icon" aria-label="End rule" onClick={() => setEnding(r)}>
                            <CalendarX />
                          </Button>
                        )}
                        {!r.is_billed && (
                          <Button variant="ghost" size="icon" className="text-destructive" aria-label="Delete rule" onClick={() => setDeleting(r)}>
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
        {rules.data && <Pagination page={page} pageSize={25} count={rules.data.count} onPageChange={setPage} />}
      </CardContent>
      <RuleDialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} rule={editing && editing !== "new" ? editing : undefined} />
      <EndRuleDialog rule={ending} onClose={() => setEnding(null)} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete rule?"
        description="It has never been billed, so it can be removed completely."
        confirmLabel="Delete"
        destructive
        loading={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => {
              toast.success("Rule deleted");
              setDeleting(null);
            },
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />
    </Card>
  );
}

function EndRuleDialog({ rule, onClose }: { rule: ChargeRule | null; onClose: () => void }) {
  const end = useEndChargeRule();
  const [date, setDate] = React.useState("");
  return (
    <Dialog open={rule !== null} onOpenChange={(o) => { if (!o) { end.reset(); setDate(""); onClose(); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>End rule</DialogTitle>
          <DialogDescription>
            {rule?.charge_type_name} for {rule?.target_name} stops applying after this date.
          </DialogDescription>
        </DialogHeader>
        {end.isError && <Alert variant="error" title={end.error.message} />}
        <FormField id="end-date" label="Last day it applies">
          <Input type="date" min={rule?.effective_from} value={date} onChange={(e) => setDate(e.target.value)} />
        </FormField>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!date}
            loading={end.isPending}
            onClick={() =>
              rule &&
              end.mutate(
                { id: rule.id, effective_to: date },
                {
                  onSuccess: () => {
                    toast.success("Rule ended");
                    setDate("");
                    onClose();
                  },
                },
              )
            }
          >
            End rule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChargeTypesCard() {
  const { can } = useOrganization();
  const types = useChargeTypes();
  const save = useSaveChargeType();
  const [name, setName] = React.useState("");
  const canConfigure = can("billing.configure");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Charge types</CardTitle>
        <CardDescription>Names used on invoices and how they count in reports.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {types.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : types.isError ? (
          <ErrorState message={errorMessage(types.error)} />
        ) : (
          <ul className="divide-y rounded-lg border text-sm">
            {types.data.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span>
                  {t.name}
                  {t.meter_utility && <span className="ml-2 text-xs text-muted-foreground">metered</span>}
                </span>
                <span className="text-xs text-muted-foreground">{INCOME[t.income_category]}</span>
              </li>
            ))}
          </ul>
        )}
        {canConfigure && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(
                { name: name.trim(), income_category: "service_charge" },
                {
                  onSuccess: () => {
                    toast.success("Charge type added");
                    setName("");
                  },
                  onError: (err) => toast.error(errorMessage(err)),
                },
              );
            }}
          >
            <Input aria-label="New charge type" placeholder="Add a custom charge, e.g. Gym" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
            <Button type="submit" variant="outline" disabled={name.trim().length < 2} loading={save.isPending}>
              Add
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function AutomationCard() {
  const { can } = useOrganization();
  const settings = useBillingSettings();
  const save = useSaveBillingSettings();
  const canConfigure = can("billing.configure");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings2 className="size-4" /> Automatic billing
        </CardTitle>
        <CardDescription>
          Generate each month&apos;s invoices automatically. Runs are safe to repeat; nothing is
          billed twice.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {settings.isPending ? (
          <Skeleton className="h-20 w-full" />
        ) : settings.isError ? (
          <ErrorState message={errorMessage(settings.error)} />
        ) : (
          <fieldset disabled={!canConfigure || save.isPending} className="space-y-4">
            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-[var(--accent)]"
                checked={settings.data.auto_generate}
                onChange={(e) =>
                  save.mutate({ auto_generate: e.target.checked }, { onSuccess: () => toast.success("Saved"), onError: (err) => toast.error(errorMessage(err)) })
                }
              />
              Generate invoices automatically
            </label>
            <FormField id="gen-day" label="Day of the month" hint="Invoices for the month are generated on or after this day.">
              <NativeSelect
                className="w-32"
                value={settings.data.generate_day}
                onChange={(e) =>
                  save.mutate({ generate_day: Number(e.target.value) }, { onSuccess: () => toast.success("Saved"), onError: (err) => toast.error(errorMessage(err)) })
                }
              >
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          </fieldset>
        )}
      </CardContent>
    </Card>
  );
}
