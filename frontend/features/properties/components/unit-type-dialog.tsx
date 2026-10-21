"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import * as React from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input, NativeSelect } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useSaveUnitType } from "@/features/properties/api";
import { applyServerErrors, bannerError, moneyString, optionalText } from "@/lib/forms";
import { UNIT_CATEGORY } from "@/lib/labels";
import type { UnitCategory, UnitType } from "@/types/api";

const BEDROOMS: Partial<Record<UnitCategory, number>> = {
  bedsitter: 0,
  studio: 0,
  one_bedroom: 1,
  two_bedroom: 2,
  three_bedroom: 3,
  four_bedroom: 4,
  shop: 0,
};

const schema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(100),
  category: z.enum(Object.keys(UNIT_CATEGORY) as [UnitCategory, ...UnitCategory[]]),
  bedrooms: z.coerce.number<string>().int().min(0).max(20),
  bathrooms: z.coerce.number<string>().int().min(0).max(20),
  default_rent: moneyString("the rent"),
  default_deposit: moneyString("the deposit"),
  description: optionalText(2000),
});
type Values = z.input<typeof schema>;
type Output = z.output<typeof schema>;

export function UnitTypeDialog({
  open,
  onOpenChange,
  propertyId,
  unitType,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: string;
  unitType?: UnitType;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open && (
          <UnitTypeForm propertyId={propertyId} unitType={unitType} onDone={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function UnitTypeForm({
  propertyId,
  unitType,
  onDone,
}: {
  propertyId: string;
  unitType?: UnitType;
  onDone: () => void;
}) {
  const save = useSaveUnitType();
  const [banner, setBanner] = React.useState<string | null>(null);
  const form = useForm<Values, unknown, Output>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: unitType?.name ?? "",
      category: unitType?.category ?? "one_bedroom",
      bedrooms: String(unitType?.bedrooms ?? 1),
      bathrooms: String(unitType?.bathrooms ?? 1),
      default_rent: unitType?.default_rent ?? "",
      default_deposit: unitType?.default_deposit ?? "0",
      description: unitType?.description ?? "",
    },
  });
  const errors = form.formState.errors;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{unitType ? "Edit unit type" : "Add a unit type"}</DialogTitle>
      </DialogHeader>
      <form
        noValidate
        className="space-y-4"
        onSubmit={form.handleSubmit((v) => {
          setBanner(null);
          save.mutate(
            { id: unitType?.id, property: propertyId, ...v },
            {
              onSuccess: () => {
                toast.success(unitType ? "Unit type updated" : "Unit type added");
                onDone();
              },
              onError: (err) => setBanner(bannerError(err, applyServerErrors(err, form))),
            },
          );
        })}
      >
        {banner && <Alert variant="error" title={banner} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="ut-category" label="Category">
            <NativeSelect
              {...form.register("category", {
                onChange: (e) => {
                  const beds = BEDROOMS[e.target.value as UnitCategory];
                  if (beds !== undefined) form.setValue("bedrooms", String(beds));
                  if (!form.getValues("name")) {
                    form.setValue("name", UNIT_CATEGORY[e.target.value as UnitCategory]);
                  }
                },
              })}
            >
              {Object.entries(UNIT_CATEGORY).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField id="ut-name" label="Name" error={errors.name?.message} hint="e.g. “2 bedroom with balcony”">
            <Input {...form.register("name")} />
          </FormField>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="ut-bed" label="Bedrooms" error={errors.bedrooms?.message}>
            <Input type="number" min={0} {...form.register("bedrooms")} />
          </FormField>
          <FormField id="ut-bath" label="Bathrooms" error={errors.bathrooms?.message}>
            <Input type="number" min={0} {...form.register("bathrooms")} />
          </FormField>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            id="ut-rent"
            label="Default monthly rent"
            error={errors.default_rent?.message}
            hint="New units start with this asking rent."
          >
            <Input inputMode="decimal" {...form.register("default_rent")} />
          </FormField>
          <FormField
            id="ut-deposit"
            label="Default deposit"
            error={errors.default_deposit?.message}
            hint="Use 0 if you don't take a deposit."
          >
            <Input inputMode="decimal" {...form.register("default_deposit")} />
          </FormField>
        </div>
        <FormField id="ut-desc" label="Description" error={errors.description?.message}>
          <Textarea rows={2} {...form.register("description")} />
        </FormField>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            Save
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
