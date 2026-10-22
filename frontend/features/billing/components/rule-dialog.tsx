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
import { useChargeTypes, useSaveChargeRule } from "@/features/billing/api";
import { usePropertyOptions, useUnits, useUnitTypes } from "@/features/properties/api";
import { ApiError } from "@/lib/api/errors";
import { RULE_METHOD, RULE_SCOPE } from "@/lib/labels";
import { todayIn } from "@/lib/utils";
import type { ChargeRule, RuleMethod, RuleScope } from "@/types/api";

interface State {
  charge_type: string;
  scope: RuleScope;
  property: string;
  unit_type: string;
  unit: string;
  method: RuleMethod;
  amount: string;
  usage_unit: string;
  is_enabled: boolean;
  included_in_rent: boolean;
  effective_from: string;
  effective_to: string;
  description: string;
}

export function RuleDialog({
  open,
  onOpenChange,
  rule,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  rule?: ChargeRule;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">{open && <RuleForm rule={rule} onDone={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function RuleForm({ rule, onDone }: { rule?: ChargeRule; onDone: () => void }) {
  const { current } = useOrganization();
  const types = useChargeTypes();
  const properties = usePropertyOptions();
  const save = useSaveChargeRule();
  const [s, setS] = React.useState<State>({
    charge_type: rule?.charge_type ?? "",
    scope: rule?.scope ?? "organization",
    property: rule?.property ?? "",
    unit_type: rule?.unit_type ?? "",
    unit: rule?.unit ?? "",
    method: rule?.method ?? "fixed_monthly",
    amount: rule ? String(Number(rule.amount)) : "",
    usage_unit: rule?.usage_unit ?? "",
    is_enabled: rule?.is_enabled ?? true,
    included_in_rent: rule?.included_in_rent ?? false,
    effective_from: rule?.effective_from ?? todayIn(current.organization.timezone).slice(0, 8) + "01",
    effective_to: rule?.effective_to ?? "",
    description: rule?.description ?? "",
  });
  // For unit-type / unit scopes, pick the property first to narrow the list.
  const [scopeProperty, setScopeProperty] = React.useState(rule?.property ?? "");
  const unitTypes = useUnitTypes(scopeProperty || undefined, s.scope === "unit_type");
  const units = useUnits({ property: scopeProperty, page_size: 100 }, s.scope === "unit" && Boolean(scopeProperty));

  const chargeType = types.data?.find((t) => t.id === s.charge_type);
  const methods = (Object.keys(RULE_METHOD) as RuleMethod[]).filter((m) => m !== "metered" || chargeType?.meter_utility);
  const update = <K extends keyof State>(key: K, value: State[K]) => setS((prev) => ({ ...prev, [key]: value }));
  const fieldError = (f: string) => (save.error instanceof ApiError ? save.error.fieldError(f) : undefined);
  const amountLabel =
    s.method === "metered" ? `Rate per unit (${current.organization.currency})` : `Amount (${current.organization.currency})`;

  const submit = () => {
    save.mutate(
      {
        id: rule?.id,
        charge_type: s.charge_type,
        scope: s.scope,
        property: s.scope === "property" ? s.property : null,
        unit_type: s.scope === "unit_type" ? s.unit_type : null,
        unit: s.scope === "unit" ? s.unit : null,
        method: s.method,
        amount: s.method === "shared" ? "0" : s.amount || "0",
        usage_unit: s.method === "metered" ? s.usage_unit : "",
        is_enabled: s.is_enabled,
        included_in_rent: s.method === "fixed_monthly" ? s.included_in_rent : false,
        effective_from: s.effective_from,
        effective_to: s.effective_to || null,
        description: s.description,
      },
      {
        onSuccess: () => {
          toast.success(rule ? "Rule updated" : "Rule added");
          onDone();
        },
      },
    );
  };

  const targetMissing =
    (s.scope === "property" && !s.property) || (s.scope === "unit_type" && !s.unit_type) || (s.scope === "unit" && !s.unit);
  const amountInvalid = s.method !== "shared" && !/^\d+(\.\d{1,4})?$/.test(s.amount);

  return (
    <>
      <DialogHeader>
        <DialogTitle>{rule ? "Edit charge rule" : "Add a charge rule"}</DialogTitle>
        <DialogDescription>
          The most specific rule wins: a unit rule overrides its unit type, which overrides the
          property, which overrides the organization. A disabled rule switches a charge off for
          that scope.
        </DialogDescription>
      </DialogHeader>
      {save.isError && !fieldError("amount") && <Alert variant="error" title={save.error.message} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="r-type" label="Charge">
          <NativeSelect value={s.charge_type} onChange={(e) => update("charge_type", e.target.value)} disabled={Boolean(rule)}>
            <option value="">Choose…</option>
            {types.data
              ?.filter((t) => t.code !== "rent" && t.is_active)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </NativeSelect>
        </FormField>
        <FormField id="r-method" label="How it's billed">
          <NativeSelect value={s.method} onChange={(e) => update("method", e.target.value as RuleMethod)}>
            {methods.map((m) => (
              <option key={m} value={m}>
                {RULE_METHOD[m]}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField id="r-scope" label="Applies to">
          <NativeSelect value={s.scope} onChange={(e) => update("scope", e.target.value as RuleScope)}>
            {(Object.keys(RULE_SCOPE) as RuleScope[]).map((k) => (
              <option key={k} value={k}>
                {RULE_SCOPE[k]}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        {s.scope !== "organization" && (
          <FormField id="r-prop" label="Property">
            <NativeSelect
              value={s.scope === "property" ? s.property : scopeProperty}
              onChange={(e) => {
                if (s.scope === "property") update("property", e.target.value);
                else {
                  setScopeProperty(e.target.value);
                  update("unit_type", "");
                  update("unit", "");
                }
              }}
            >
              <option value="">Choose…</option>
              {properties.data?.results.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        )}
        {s.scope === "unit_type" && (
          <FormField id="r-ut" label="Unit type">
            <NativeSelect value={s.unit_type} onChange={(e) => update("unit_type", e.target.value)} disabled={!scopeProperty}>
              <option value="">Choose…</option>
              {unitTypes.data?.results.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        )}
        {s.scope === "unit" && (
          <FormField id="r-unit" label="Unit">
            <NativeSelect value={s.unit} onChange={(e) => update("unit", e.target.value)} disabled={!scopeProperty}>
              <option value="">Choose…</option>
              {units.data?.results.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.number}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        )}
        {s.method !== "shared" && (
          <FormField id="r-amount" label={amountLabel} error={fieldError("amount")}>
            <Input inputMode="decimal" value={s.amount} onChange={(e) => update("amount", e.target.value)} />
          </FormField>
        )}
        {s.method === "metered" && (
          <FormField id="r-usage" label="Unit of measure">
            <Input placeholder="e.g. m³ or kWh" maxLength={16} value={s.usage_unit} onChange={(e) => update("usage_unit", e.target.value)} />
          </FormField>
        )}
        <FormField id="r-from" label="Effective from">
          <Input type="date" value={s.effective_from} onChange={(e) => update("effective_from", e.target.value)} />
        </FormField>
        <FormField id="r-to" label="Until (optional)">
          <Input type="date" value={s.effective_to} onChange={(e) => update("effective_to", e.target.value)} />
        </FormField>
      </div>
      <div className="space-y-2">
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-0.5 size-4 accent-[var(--accent)]" checked={s.is_enabled} onChange={(e) => update("is_enabled", e.target.checked)} />
          <span>
            <span className="font-medium">Charge enabled</span>
            <span className="block text-muted-foreground">Turn off to stop billing this charge for the chosen scope.</span>
          </span>
        </label>
        {s.method === "fixed_monthly" && (
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--accent)]" checked={s.included_in_rent} onChange={(e) => update("included_in_rent", e.target.checked)} />
            <span>
              <span className="font-medium">Included in rent</span>
              <span className="block text-muted-foreground">Shown as included; never billed separately.</span>
            </span>
          </label>
        )}
      </div>
      <FormField id="r-desc" label="Note (optional)">
        <Input maxLength={255} value={s.description} onChange={(e) => update("description", e.target.value)} />
      </FormField>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button disabled={!s.charge_type || targetMissing || amountInvalid || !s.effective_from} loading={save.isPending} onClick={submit}>
          Save rule
        </Button>
      </DialogFooter>
    </>
  );
}
