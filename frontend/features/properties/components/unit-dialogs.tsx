"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ExternalLink, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { useOrganization } from "@/components/providers/organization-provider";
import { Alert } from "@/components/ui/alert";
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
import { UnitStatusBadge } from "@/components/ui/status";
import { Textarea } from "@/components/ui/textarea";
import {
  useBulkCreateUnits,
  useDeleteUnit,
  useSaveUnit,
  useSetUnitStatus,
} from "@/features/properties/api";
import { errorMessage } from "@/lib/api/errors";
import { applyServerErrors, bannerError, moneyString, optionalText } from "@/lib/forms";
import { MANUAL_UNIT_STATUSES, UNIT_STATUS } from "@/lib/labels";
import { formatMoney } from "@/lib/utils";
import type { Unit, UnitStatus, UnitType } from "@/types/api";

const unitSchema = z.object({
  unit_type: z.string().min(1, "Choose a unit type."),
  number: z.string().trim().min(1, "Enter the unit number.").max(32),
  floor: optionalText(32),
  market_rent: moneyString("the rent").or(z.literal("")),
  water_meter_number: optionalText(64),
  electricity_meter_number: optionalText(64),
  floor_area: z
    .string()
    .trim()
    .refine((v) => v === "" || (/^\d{1,6}(\.\d{1,2})?$/.test(v) && Number(v) > 0), "Enter the area in m², e.g. 45 or 62.5."),
  notes: optionalText(2000),
});
type UnitValues = z.infer<typeof unitSchema>;

export function UnitFormDialog({
  open,
  onOpenChange,
  propertyId,
  unitTypes,
  unit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: string;
  unitTypes: UnitType[];
  unit?: Unit;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open && (
          <UnitForm
            propertyId={propertyId}
            unitTypes={unitTypes}
            unit={unit}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function UnitForm({
  propertyId,
  unitTypes,
  unit,
  onDone,
}: {
  propertyId: string;
  unitTypes: UnitType[];
  unit?: Unit;
  onDone: () => void;
}) {
  const save = useSaveUnit();
  const [banner, setBanner] = React.useState<string | null>(null);
  const form = useForm<UnitValues>({
    resolver: zodResolver(unitSchema),
    defaultValues: {
      unit_type: unit?.unit_type ?? unitTypes[0]?.id ?? "",
      number: unit?.number ?? "",
      floor: unit?.floor ?? "",
      market_rent: unit?.market_rent ?? "",
      water_meter_number: unit?.water_meter_number ?? "",
      electricity_meter_number: unit?.electricity_meter_number ?? "",
      floor_area: unit?.floor_area ? String(Number(unit.floor_area)) : "",
      notes: unit?.notes ?? "",
    },
  });
  const errors = form.formState.errors;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{unit ? `Edit unit ${unit.number}` : "Add a unit"}</DialogTitle>
        {unit && (
          <DialogDescription>
            Changing the asking rent does not change existing leases.
          </DialogDescription>
        )}
      </DialogHeader>
      <form
        noValidate
        className="space-y-4"
        onSubmit={form.handleSubmit(({ market_rent, floor_area, ...v }) => {
          setBanner(null);
          save.mutate(
            {
              id: unit?.id,
              property: propertyId,
              ...v,
              floor_area: floor_area === "" ? null : floor_area,
              ...(market_rent === "" ? {} : { market_rent }),
            },
            {
              onSuccess: () => {
                toast.success(unit ? "Unit updated" : "Unit added");
                onDone();
              },
              onError: (err) => setBanner(bannerError(err, applyServerErrors(err, form))),
            },
          );
        })}
      >
        {banner && <Alert variant="error" title={banner} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="u-number" label="Unit number" error={errors.number?.message}>
            <Input placeholder="e.g. A4" {...form.register("number")} />
          </FormField>
          <FormField id="u-floor" label="Floor" error={errors.floor?.message}>
            <Input placeholder="e.g. 2nd" {...form.register("floor")} />
          </FormField>
        </div>
        <FormField id="u-type" label="Unit type" error={errors.unit_type?.message}>
          <NativeSelect {...form.register("unit_type")}>
            {unitTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · {formatMoney(t.default_rent)}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField
          id="u-rent"
          label="Asking rent (monthly)"
          error={errors.market_rent?.message}
          hint={unit ? undefined : "Leave empty to use the unit type's default rent."}
        >
          <Input inputMode="decimal" {...form.register("market_rent")} />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="u-water" label="Water meter no." error={errors.water_meter_number?.message}>
            <Input {...form.register("water_meter_number")} />
          </FormField>
          <FormField id="u-power" label="Electricity meter no." error={errors.electricity_meter_number?.message}>
            <Input {...form.register("electricity_meter_number")} />
          </FormField>
        </div>
        <FormField
          id="u-area"
          label="Floor area (m²)"
          error={errors.floor_area?.message}
          hint="Optional. Needed to split a shared cost by floor area."
        >
          <Input inputMode="decimal" {...form.register("floor_area")} />
        </FormField>
        <FormField id="u-notes" label="Notes" error={errors.notes?.message}>
          <Textarea rows={2} {...form.register("notes")} />
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

const bulkSchema = z.object({
  unit_type: z.string().min(1, "Choose a unit type."),
  prefix: z.string().trim().max(16),
  start: z.coerce.number<string>().int().min(0).max(99999),
  count: z.coerce.number<string>().int().min(1, "At least 1").max(200, "At most 200 at a time"),
  floor: optionalText(32),
});

export function BulkUnitsDialog({
  open,
  onOpenChange,
  propertyId,
  unitTypes,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: string;
  unitTypes: UnitType[];
}) {
  const bulk = useBulkCreateUnits();
  const form = useForm<z.input<typeof bulkSchema>, unknown, z.output<typeof bulkSchema>>({
    resolver: zodResolver(bulkSchema),
    defaultValues: { unit_type: unitTypes[0]?.id ?? "", prefix: "A", start: "1", count: "10", floor: "" },
  });
  const [prefix, start, count] = useWatch({
    control: form.control,
    name: ["prefix", "start", "count"],
  });
  const first = `${prefix}${start}`;
  const last = `${prefix}${Number(start) + Math.max(Number(count) - 1, 0)}`;
  const errors = form.formState.errors;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) bulk.reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add several units</DialogTitle>
          <DialogDescription>Create a numbered run of units of the same type in one go.</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="space-y-4"
          onSubmit={form.handleSubmit((v) =>
            bulk.mutate(
              { property: propertyId, ...v },
              {
                onSuccess: (res) => {
                  toast.success(`${res.created} units created`);
                  onOpenChange(false);
                },
              },
            ),
          )}
        >
          {bulk.isError && <Alert variant="error" title={bulk.error.message} />}
          <FormField id="b-type" label="Unit type" error={errors.unit_type?.message}>
            <NativeSelect {...form.register("unit_type")}>
              {unitTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} · {formatMoney(t.default_rent)}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <div className="grid grid-cols-3 gap-4">
            <FormField id="b-prefix" label="Prefix" error={errors.prefix?.message}>
              <Input {...form.register("prefix")} />
            </FormField>
            <FormField id="b-start" label="Start at" error={errors.start?.message}>
              <Input type="number" min={0} {...form.register("start")} />
            </FormField>
            <FormField id="b-count" label="How many" error={errors.count?.message}>
              <Input type="number" min={1} max={200} {...form.register("count")} />
            </FormField>
          </div>
          <FormField id="b-floor" label="Floor (optional)" error={errors.floor?.message}>
            <Input {...form.register("floor")} />
          </FormField>
          <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
            Creates units <strong className="text-foreground">{first}</strong> to{" "}
            <strong className="text-foreground">{last}</strong>.
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={bulk.isPending}>
              Create units
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Details for one unit: status changes, edit and delete. */
export function UnitDetailDialog({
  unit,
  unitTypes,
  onOpenChange,
}: {
  unit: Unit | null;
  unitTypes: UnitType[];
  onOpenChange: (open: boolean) => void;
}) {
  const { can, current } = useOrganization();
  const setStatus = useSetUnitStatus();
  const remove = useDeleteUnit();
  const [editing, setEditing] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [nextStatus, setNextStatus] = React.useState<UnitStatus | "">("");
  const canManage = can("properties.manage");

  if (!unit) return null;
  const manual = MANUAL_UNIT_STATUSES.includes(unit.status) || unit.status === "awaiting_inspection";

  return (
    <>
      <Dialog open={!editing && !deleting} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              Unit {unit.number} <UnitStatusBadge status={unit.status} />
            </DialogTitle>
            <DialogDescription>
              {unit.property_name} · {unit.unit_type_name}
              {unit.floor && ` · Floor ${unit.floor}`}
            </DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Asking rent</dt>
              <dd className="font-medium">{formatMoney(unit.market_rent, current.organization.currency)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Current lease</dt>
              <dd className="font-medium">
                {unit.current_lease ? (
                  can("leases.view") ? (
                    <Link
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                      href={`/dashboard/leases/${unit.current_lease.id}`}
                    >
                      {unit.current_lease.reference} <ExternalLink className="size-3" />
                    </Link>
                  ) : (
                    unit.current_lease.reference
                  )
                ) : (
                  "None"
                )}
                {unit.current_lease?.tenant_name && (
                  <span className="block text-xs font-normal text-muted-foreground">
                    {unit.current_lease.tenant_name}
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Water meter</dt>
              <dd>{unit.water_meter_number || "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Electricity meter</dt>
              <dd>{unit.electricity_meter_number || "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Floor area</dt>
              <dd>{unit.floor_area ? `${Number(unit.floor_area)} m²` : "—"}</dd>
            </div>
          </dl>
          {unit.notes && <p className="rounded-lg bg-muted p-3 text-sm">{unit.notes}</p>}

          {canManage && (
            <div className="space-y-2 border-t pt-4">
              <p className="text-sm font-medium">Change status</p>
              {manual ? (
                <div className="flex gap-2">
                  <NativeSelect
                    aria-label="New status"
                    value={nextStatus}
                    onChange={(e) => setNextStatus(e.target.value as UnitStatus)}
                  >
                    <option value="">Choose…</option>
                    {MANUAL_UNIT_STATUSES.filter((s) => s !== unit.status).map((s) => (
                      <option key={s} value={s}>
                        {UNIT_STATUS[s].label}
                      </option>
                    ))}
                  </NativeSelect>
                  <Button
                    variant="outline"
                    disabled={!nextStatus}
                    loading={setStatus.isPending}
                    onClick={() =>
                      nextStatus &&
                      setStatus.mutate(
                        { id: unit.id, status: nextStatus },
                        {
                          onSuccess: () => {
                            toast.success(`Unit ${unit.number} is now ${UNIT_STATUS[nextStatus].label.toLowerCase()}`);
                            setNextStatus("");
                            onOpenChange(false);
                          },
                          onError: (err) => toast.error(errorMessage(err)),
                        },
                      )
                    }
                  >
                    Apply
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  This status is managed by the unit&apos;s lease. End or change the lease to
                  release the unit.
                </p>
              )}
            </div>
          )}
          {canManage && (
            <DialogFooter className="border-t pt-4 sm:justify-between">
              <Button variant="ghost" className="text-destructive" onClick={() => setDeleting(true)}>
                <Trash2 /> Delete
              </Button>
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil /> Edit unit
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
      <UnitFormDialog
        open={editing}
        onOpenChange={(open) => {
          setEditing(open);
          if (!open) onOpenChange(false);
        }}
        propertyId={unit.property}
        unitTypes={unitTypes}
        unit={unit}
      />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete unit ${unit.number}?`}
        description="Only units that have never had a lease can be deleted. Mark it unavailable instead to keep its history."
        confirmLabel="Delete unit"
        destructive
        loading={remove.isPending}
        onConfirm={() =>
          remove.mutate(unit.id, {
            onSuccess: () => {
              toast.success("Unit deleted");
              setDeleting(false);
              onOpenChange(false);
            },
            onError: (err) => {
              toast.error(errorMessage(err));
              setDeleting(false);
            },
          })
        }
      />
    </>
  );
}
