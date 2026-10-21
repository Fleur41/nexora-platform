"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { PageHeader } from "@/components/layout/page-header";
import { useOrganization } from "@/components/providers/organization-provider";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input, NativeSelect } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCreateLease } from "@/features/leases/api";
import { usePropertyOptions, useUnits, useUnitTypes } from "@/features/properties/api";
import { useTenant, useTenants } from "@/features/tenants/api";
import { TenantFormDialog } from "@/features/tenants/components/tenant-form-dialog";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { applyServerErrors, bannerError, moneyString, optionalText } from "@/lib/forms";
import { BILLING_FREQUENCY } from "@/lib/labels";
import { formatMoney, todayIn } from "@/lib/utils";
import type { BillingFrequency, Tenant } from "@/types/api";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.");

const schema = z
  .object({
    tenant: z.string().min(1, "Choose a tenant."),
    property: z.string().min(1, "Choose a property."),
    unit: z.string().min(1, "Choose a unit."),
    start_date: date,
    end_date: date.or(z.literal("")),
    monthly_rent: moneyString("the monthly rent"),
    deposit_amount: moneyString("the deposit"),
    billing_frequency: z.enum(Object.keys(BILLING_FREQUENCY) as [BillingFrequency, ...BillingFrequency[]]),
    rent_due_day: z.coerce.number<string>().int().min(1, "1–28").max(28, "1–28"),
    notes: optionalText(5000),
    activate: z.boolean(),
  })
  .refine((v) => !v.end_date || v.end_date >= v.start_date, {
    path: ["end_date"],
    message: "The end date must be on or after the start date.",
  });
type Values = z.input<typeof schema>;
type Output = z.output<typeof schema>;

export function LeaseForm() {
  const { can, current } = useOrganization();
  const router = useRouter();
  const params = useSearchParams();
  const create = useCreateLease();
  const [banner, setBanner] = React.useState<string | null>(null);
  const [registering, setRegistering] = React.useState(false);
  const [tenantSearch, setTenantSearch] = React.useState("");
  const [extraTenant, setExtraTenant] = React.useState<Tenant | null>(null);
  const debouncedTenant = useDebouncedValue(tenantSearch, 300);
  const presetTenant = params.get("tenant") ?? "";
  const currency = current.organization.currency;

  const form = useForm<Values, unknown, Output>({
    resolver: zodResolver(schema),
    defaultValues: {
      tenant: presetTenant,
      property: "",
      unit: "",
      start_date: todayIn(current.organization.timezone),
      end_date: "",
      monthly_rent: "",
      deposit_amount: "0",
      billing_frequency: "monthly",
      rent_due_day: "1",
      notes: "",
      activate: true,
    },
  });
  const [propertyId, unitId, tenantId] = useWatch({ control: form.control, name: ["property", "unit", "tenant"] });

  const tenants = useTenants({ search: debouncedTenant, status: "active", page_size: 50 });
  const preset = useTenant(presetTenant || "none");
  const properties = usePropertyOptions();
  const units = useUnits({ property: propertyId, status: "available", page_size: 100 }, Boolean(propertyId));
  const unitTypes = useUnitTypes(propertyId);

  // Merge search results with the preselected/new tenant so the select can always show them.
  const tenantOptions = React.useMemo(() => {
    const list = [...(tenants.data?.results ?? [])];
    for (const extra of [presetTenant ? preset.data : undefined, extraTenant]) {
      if (extra && !list.some((t) => t.id === extra.id)) list.unshift(extra);
    }
    return list;
  }, [tenants.data, preset.data, presetTenant, extraTenant]);

  const chooseUnit = (id: string) => {
    form.setValue("unit", id, { shouldValidate: true });
    const unit = units.data?.results.find((u) => u.id === id);
    if (!unit) return;
    // Prefill from the unit's asking rent and its type's default deposit; both stay editable.
    form.setValue("monthly_rent", unit.market_rent);
    const type = unitTypes.data?.results.find((t) => t.id === unit.unit_type);
    if (type) form.setValue("deposit_amount", type.default_deposit);
  };

  if (!can("leases.manage")) {
    return <Alert variant="error" title="You don't have permission to create leases." />;
  }
  const errors = form.formState.errors;

  return (
    <>
      <Link href="/dashboard/leases" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Leases
      </Link>
      <PageHeader title="New lease" description="Let an available unit to a tenant." />
      <form
        noValidate
        className="grid max-w-4xl gap-6"
        onSubmit={form.handleSubmit(({ property: _property, end_date, ...v }) => {
          void _property;
          setBanner(null);
          create.mutate(
            { ...v, end_date: end_date || null },
            {
              onSuccess: (lease) => {
                toast.success(lease.status === "active" ? `Lease ${lease.reference} is active` : `Draft ${lease.reference} saved`);
                router.push(`/dashboard/leases/${lease.id}`);
              },
              onError: (err) => setBanner(bannerError(err, applyServerErrors(err, form))),
            },
          );
        })}
      >
        {banner && <Alert variant="error" title={banner} />}
        <Card>
          <CardHeader>
            <CardTitle>Tenant and unit</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  aria-label="Search tenants"
                  placeholder="Search tenants by name or phone"
                  value={tenantSearch}
                  onChange={(e) => setTenantSearch(e.target.value)}
                />
                {can("tenants.manage") && (
                  <Button type="button" variant="outline" onClick={() => setRegistering(true)}>
                    <UserPlus /> New tenant
                  </Button>
                )}
              </div>
              <FormField id="l-tenant" label="Tenant" error={errors.tenant?.message}>
                <NativeSelect {...form.register("tenant")} value={tenantId}>
                  <option value="">{tenants.isPending ? "Loading…" : "Choose a tenant"}</option>
                  {tenantOptions.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.full_name} · {t.phone}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
            </div>
            <FormField id="l-property" label="Property" error={errors.property?.message}>
              <NativeSelect
                {...form.register("property", {
                  onChange: () => form.setValue("unit", ""),
                })}
              >
                <option value="">Choose a property</option>
                {properties.data?.results.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.available_count} available)
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField
              id="l-unit"
              label="Unit"
              error={errors.unit?.message}
              hint={propertyId && units.data?.results.length === 0 ? "No available units in this property." : "Only available units are listed."}
            >
              <NativeSelect value={unitId} onChange={(e) => chooseUnit(e.target.value)} disabled={!propertyId}>
                <option value="">{propertyId ? "Choose a unit" : "Choose a property first"}</option>
                {units.data?.results.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.number} · {u.unit_type_name} · {formatMoney(u.market_rent, currency)}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Terms</CardTitle>
            <CardDescription>
              Rent is stored with an effective date. Later increases are scheduled from the lease
              page and never change past periods.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField id="l-start" label="Start date" error={errors.start_date?.message} hint="Backdate to record an existing tenancy.">
              <Input type="date" {...form.register("start_date")} />
            </FormField>
            <FormField id="l-end" label="End date (optional)" error={errors.end_date?.message} hint="Leave empty for a periodic tenancy.">
              <Input type="date" {...form.register("end_date")} />
            </FormField>
            <FormField id="l-rent" label={`Monthly rent (${currency})`} error={errors.monthly_rent?.message}>
              <Input inputMode="decimal" {...form.register("monthly_rent")} />
            </FormField>
            <FormField id="l-deposit" label={`Deposit (${currency})`} error={errors.deposit_amount?.message} hint="Enter 0 if there is no deposit.">
              <Input inputMode="decimal" {...form.register("deposit_amount")} />
            </FormField>
            <FormField id="l-freq" label="Billing frequency" error={errors.billing_frequency?.message}>
              <NativeSelect {...form.register("billing_frequency")}>
                {Object.entries(BILLING_FREQUENCY).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField id="l-due" label="Rent due day of month" error={errors.rent_due_day?.message}>
              <Input type="number" min={1} max={28} {...form.register("rent_due_day")} />
            </FormField>
            <div className="sm:col-span-2">
              <FormField id="l-notes" label="Notes" error={errors.notes?.message}>
                <Textarea rows={2} {...form.register("notes")} />
              </FormField>
            </div>
            <label className="flex items-start gap-3 text-sm sm:col-span-2">
              <input type="checkbox" className="mt-0.5 size-4 accent-[var(--accent)]" {...form.register("activate")} />
              <span>
                <span className="font-medium">Activate now</span>
                <span className="block text-muted-foreground">
                  Marks the unit occupied (or reserved if the lease starts in the future). Leave
                  unchecked to save a draft you can still edit.
                </span>
              </span>
            </label>
          </CardContent>
        </Card>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" asChild>
            <Link href="/dashboard/leases">Cancel</Link>
          </Button>
          <Button type="submit" loading={create.isPending}>
            Create lease
          </Button>
        </div>
      </form>
      <TenantFormDialog
        open={registering}
        onOpenChange={setRegistering}
        onCreated={(t) => {
          setExtraTenant(t);
          form.setValue("tenant", t.id, { shouldValidate: true });
        }}
      />
    </>
  );
}
