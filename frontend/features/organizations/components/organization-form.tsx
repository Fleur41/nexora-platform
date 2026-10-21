"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import * as React from "react";
import { useForm } from "react-hook-form";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input, NativeSelect } from "@/components/ui/input";
import {
  ORGANIZATION_DEFAULTS,
  organizationSchema,
  type OrganizationValues,
} from "@/features/organizations/schemas";
import { ApiError } from "@/lib/api/errors";

const TIMEZONES = [
  "Africa/Nairobi",
  "Africa/Kampala",
  "Africa/Dar_es_Salaam",
  "Africa/Kigali",
  "Africa/Lagos",
  "Africa/Johannesburg",
  "Africa/Cairo",
  "Europe/London",
  "UTC",
];

interface OrganizationFormProps {
  initialValues?: Partial<OrganizationValues>;
  submitLabel: string;
  pending: boolean;
  error: unknown;
  compact?: boolean;
  disabled?: boolean;
  onSubmit: (values: OrganizationValues) => void;
}

export function OrganizationForm({
  initialValues,
  submitLabel,
  pending,
  error,
  compact,
  disabled,
  onSubmit,
}: OrganizationFormProps) {
  const form = useForm<OrganizationValues>({
    resolver: zodResolver(organizationSchema),
    defaultValues: { ...ORGANIZATION_DEFAULTS, ...initialValues },
  });

  React.useEffect(() => {
    if (!(error instanceof ApiError)) return;
    for (const field of Object.keys(ORGANIZATION_DEFAULTS) as (keyof OrganizationValues)[]) {
      const message = error.fieldError(field);
      if (message) form.setError(field, { message });
    }
  }, [error, form]);

  const errors = form.formState.errors;
  const hasFieldErrors = error instanceof ApiError && Object.keys(error.details).length > 0;

  return (
    <form noValidate onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
      {error instanceof Error && !hasFieldErrors ? (
        <Alert variant="error" title={error.message} />
      ) : null}
      <fieldset disabled={disabled} className="space-y-5">
        <FormField
          id="name"
          label="Organization name"
          error={errors.name?.message}
          hint="The name your tenants and team will see, e.g. “Kilimani Homes”."
        >
          <Input {...form.register("name")} />
        </FormField>
        {!compact && (
          <>
            <FormField id="legal_name" label="Registered business name" error={errors.legal_name?.message}>
              <Input {...form.register("legal_name")} />
            </FormField>
            <div className="grid gap-5 sm:grid-cols-2">
              <FormField id="email" label="Contact email" error={errors.email?.message}>
                <Input type="email" {...form.register("email")} />
              </FormField>
              <FormField id="phone" label="Contact phone" error={errors.phone?.message}>
                <Input type="tel" {...form.register("phone")} />
              </FormField>
            </div>
            <FormField id="address" label="Address" error={errors.address?.message}>
              <Input {...form.register("address")} />
            </FormField>
          </>
        )}
        <div className="grid gap-5 sm:grid-cols-3">
          <FormField id="country" label="Country" error={errors.country?.message}>
            <Input maxLength={2} className="uppercase" {...form.register("country")} />
          </FormField>
          <FormField id="currency" label="Currency" error={errors.currency?.message}>
            <Input maxLength={3} className="uppercase" {...form.register("currency")} />
          </FormField>
          <FormField id="timezone" label="Timezone" error={errors.timezone?.message}>
            <NativeSelect {...form.register("timezone")}>
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz.replace("_", " ")}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        </div>
      </fieldset>
      {!disabled && (
        <Button type="submit" loading={pending} className={compact ? "w-full" : undefined}>
          {submitLabel}
        </Button>
      )}
    </form>
  );
}
