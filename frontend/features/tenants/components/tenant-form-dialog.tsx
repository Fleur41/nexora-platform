"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import * as React from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

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
import { Textarea } from "@/components/ui/textarea";
import { useSaveTenant } from "@/features/tenants/api";
import { applyServerErrors, bannerError, optionalText } from "@/lib/forms";
import { ID_TYPE } from "@/lib/labels";
import type { Tenant, TenantIdType } from "@/types/api";

const phone = z
  .string()
  .trim()
  .regex(/^[+\d][\d\s-]{7,19}$/, "Enter a valid phone number, e.g. 0712 345 678.");

const schema = z.object({
  full_name: z.string().trim().min(2, "Enter the tenant's full name.").max(200),
  phone,
  email: z.string().trim().email("Enter a valid email address.").or(z.literal("")),
  alternate_phone: phone.or(z.literal("")),
  id_type: z.enum(Object.keys(ID_TYPE) as [TenantIdType, ...TenantIdType[]]),
  id_number: optionalText(64),
  kra_pin: optionalText(20),
  occupation: optionalText(120),
  employer: optionalText(200),
  emergency_contact_name: optionalText(200),
  emergency_contact_phone: phone.or(z.literal("")),
  notes: optionalText(5000),
});
type Values = z.infer<typeof schema>;

export function TenantFormDialog({
  open,
  onOpenChange,
  tenant,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenant?: Tenant;
  /** Called instead of navigating to the new tenant (used from the lease form). */
  onCreated?: (tenant: Tenant) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        {open && <TenantForm tenant={tenant} onCreated={onCreated} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function TenantForm({
  tenant,
  onCreated,
  onDone,
}: {
  tenant?: Tenant;
  onCreated?: (tenant: Tenant) => void;
  onDone: () => void;
}) {
  const router = useRouter();
  const save = useSaveTenant();
  const [banner, setBanner] = React.useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      full_name: tenant?.full_name ?? "",
      phone: tenant?.phone ?? "",
      email: tenant?.email ?? "",
      alternate_phone: tenant?.alternate_phone ?? "",
      id_type: tenant?.id_type ?? "national_id",
      id_number: tenant?.id_number ?? "",
      kra_pin: tenant?.kra_pin ?? "",
      occupation: tenant?.occupation ?? "",
      employer: tenant?.employer ?? "",
      emergency_contact_name: tenant?.emergency_contact_name ?? "",
      emergency_contact_phone: tenant?.emergency_contact_phone ?? "",
      notes: tenant?.notes ?? "",
    },
  });
  const errors = form.formState.errors;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{tenant ? "Edit tenant" : "Register a tenant"}</DialogTitle>
        <DialogDescription>
          Identity details are visible only to staff who can manage tenants.
        </DialogDescription>
      </DialogHeader>
      <form
        noValidate
        className="space-y-4"
        onSubmit={form.handleSubmit((v) => {
          setBanner(null);
          save.mutate(
            { id: tenant?.id, ...v },
            {
              onSuccess: (saved) => {
                toast.success(tenant ? "Tenant updated" : `${saved.full_name} registered`);
                onDone();
                if (!tenant) {
                  if (onCreated) onCreated(saved);
                  else router.push(`/dashboard/tenants/${saved.id}`);
                }
              },
              onError: (err) => setBanner(bannerError(err, applyServerErrors(err, form))),
            },
          );
        })}
      >
        {banner && <Alert variant="error" title={banner} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="t-name" label="Full name" error={errors.full_name?.message}>
            <Input autoComplete="off" {...form.register("full_name")} />
          </FormField>
          <FormField id="t-phone" label="Phone" error={errors.phone?.message}>
            <Input type="tel" placeholder="0712 345 678" {...form.register("phone")} />
          </FormField>
          <FormField id="t-email" label="Email (optional)" error={errors.email?.message}>
            <Input type="email" {...form.register("email")} />
          </FormField>
          <FormField id="t-alt" label="Alternate phone" error={errors.alternate_phone?.message}>
            <Input type="tel" {...form.register("alternate_phone")} />
          </FormField>
          <FormField id="t-idtype" label="ID type">
            <NativeSelect {...form.register("id_type")}>
              {Object.entries(ID_TYPE).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField id="t-idno" label="ID number" error={errors.id_number?.message}>
            <Input autoComplete="off" {...form.register("id_number")} />
          </FormField>
          <FormField id="t-kra" label="KRA PIN" error={errors.kra_pin?.message}>
            <Input autoComplete="off" {...form.register("kra_pin")} />
          </FormField>
          <FormField id="t-occupation" label="Occupation" error={errors.occupation?.message}>
            <Input {...form.register("occupation")} />
          </FormField>
          <FormField id="t-employer" label="Employer" error={errors.employer?.message}>
            <Input {...form.register("employer")} />
          </FormField>
          <FormField id="t-ec-name" label="Emergency contact" error={errors.emergency_contact_name?.message}>
            <Input {...form.register("emergency_contact_name")} />
          </FormField>
          <FormField id="t-ec-phone" label="Emergency contact phone" error={errors.emergency_contact_phone?.message}>
            <Input type="tel" {...form.register("emergency_contact_phone")} />
          </FormField>
        </div>
        <FormField id="t-notes" label="Private notes" error={errors.notes?.message}>
          <Textarea rows={2} {...form.register("notes")} />
        </FormField>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            {tenant ? "Save changes" : "Register tenant"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
