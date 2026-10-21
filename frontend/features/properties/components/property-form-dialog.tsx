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
import { useSaveProperty } from "@/features/properties/api";
import { applyServerErrors, bannerError, optionalText } from "@/lib/forms";
import { PROPERTY_TYPE } from "@/lib/labels";
import type { Property, PropertyType } from "@/types/api";

const coordinate = (min: number, max: number) =>
  z
    .string()
    .trim()
    .refine((v) => v === "" || (!Number.isNaN(Number(v)) && Number(v) >= min && Number(v) <= max), {
      message: `Enter a number between ${min} and ${max}.`,
    });

const schema = z.object({
  name: z.string().trim().min(2, "Enter the property name.").max(200),
  property_type: z.enum(Object.keys(PROPERTY_TYPE) as [PropertyType, ...PropertyType[]]),
  address_line: optionalText(255),
  town: optionalText(100),
  county: optionalText(100),
  latitude: coordinate(-90, 90),
  longitude: coordinate(-180, 180),
  map_url: z.string().trim().url("Enter a full link, e.g. https://maps.google.com/…").or(z.literal("")),
  description: optionalText(5000),
  amenities: optionalText(2000),
});
type Values = z.infer<typeof schema>;

function toValues(p?: Property): Values {
  return {
    name: p?.name ?? "",
    property_type: p?.property_type ?? "apartments",
    address_line: p?.address_line ?? "",
    town: p?.town ?? "",
    county: p?.county ?? "",
    latitude: p?.latitude ?? "",
    longitude: p?.longitude ?? "",
    map_url: p?.map_url ?? "",
    description: p?.description ?? "",
    amenities: p?.amenities.join(", ") ?? "",
  };
}

export function PropertyFormDialog({
  open,
  onOpenChange,
  property,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  property?: Property;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        {open && <PropertyForm property={property} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function PropertyForm({ property, onDone }: { property?: Property; onDone: () => void }) {
  const router = useRouter();
  const save = useSaveProperty();
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: toValues(property) });
  const [banner, setBanner] = React.useState<string | null>(null);
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit((v) => {
    setBanner(null);
    save.mutate(
      {
        id: property?.id,
        ...v,
        latitude: v.latitude === "" ? null : v.latitude,
        longitude: v.longitude === "" ? null : v.longitude,
        amenities: v.amenities
          .split(",")
          .map((a) => a.trim())
          .filter(Boolean),
      },
      {
        onSuccess: (saved) => {
          toast.success(property ? "Property updated" : `${saved.name} created`);
          onDone();
          if (!property) router.push(`/dashboard/properties/${saved.id}`);
        },
        onError: (err) => setBanner(bannerError(err, applyServerErrors(err, form))),
      },
    );
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>{property ? "Edit property" : "Add a property"}</DialogTitle>
        <DialogDescription>
          {property
            ? `Reference ${property.reference}`
            : "You can add unit types and units right after creating it."}
        </DialogDescription>
      </DialogHeader>
      <form noValidate onSubmit={onSubmit} className="space-y-4">
        {banner && <Alert variant="error" title={banner} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="p-name" label="Name" error={errors.name?.message}>
            <Input {...form.register("name")} />
          </FormField>
          <FormField id="p-type" label="Type">
            <NativeSelect {...form.register("property_type")}>
              {Object.entries(PROPERTY_TYPE).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        </div>
        <FormField id="p-address" label="Street / building address" error={errors.address_line?.message}>
          <Input {...form.register("address_line")} />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="p-town" label="Town / area" error={errors.town?.message}>
            <Input placeholder="e.g. Kilimani" {...form.register("town")} />
          </FormField>
          <FormField id="p-county" label="County" error={errors.county?.message}>
            <Input placeholder="e.g. Nairobi" {...form.register("county")} />
          </FormField>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField id="p-lat" label="Latitude" error={errors.latitude?.message}>
            <Input inputMode="decimal" placeholder="-1.2921" {...form.register("latitude")} />
          </FormField>
          <FormField id="p-lng" label="Longitude" error={errors.longitude?.message}>
            <Input inputMode="decimal" placeholder="36.8219" {...form.register("longitude")} />
          </FormField>
          <FormField id="p-map" label="Map link" error={errors.map_url?.message}>
            <Input type="url" {...form.register("map_url")} />
          </FormField>
        </div>
        <FormField
          id="p-amenities"
          label="Amenities"
          hint="Separate with commas, e.g. Borehole, Parking, CCTV, Lift"
          error={errors.amenities?.message}
        >
          <Input {...form.register("amenities")} />
        </FormField>
        <FormField id="p-desc" label="Description" error={errors.description?.message}>
          <Textarea rows={3} {...form.register("description")} />
        </FormField>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            {property ? "Save changes" : "Create property"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
