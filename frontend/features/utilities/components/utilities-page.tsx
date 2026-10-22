"use client";

import { Gauge, History, Plus, Trash2 } from "lucide-react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePropertyOptions, useUnits } from "@/features/properties/api";
import {
  useBulkReadings,
  useCreateMeter,
  useDeactivateMeter,
  useDeleteReading,
  useMeters,
  useReadings,
} from "@/features/utilities/api";
import { ApiError, errorMessage } from "@/lib/api/errors";
import { METER_UTILITY } from "@/lib/labels";
import { formatDay, todayIn } from "@/lib/utils";
import type { Meter, MeterUtility } from "@/types/api";

export function UtilitiesPage() {
  const { can, current } = useOrganization();
  const allowed = can("meters.view");
  const properties = usePropertyOptions(allowed);
  const [chosen, setChosen] = React.useState("");
  const propertyId = chosen || properties.data?.results[0]?.id || "";
  const [utility, setUtility] = React.useState<MeterUtility | "">("");
  const meters = useMeters({ "unit__property": propertyId, utility: utility || undefined, is_active: true }, allowed && Boolean(propertyId));
  const bulk = useBulkReadings();
  const [date, setDate] = React.useState(todayIn(current.organization.timezone));
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [adding, setAdding] = React.useState(false);
  const [history, setHistory] = React.useState<Meter | null>(null);
  const canRecord = can("meters.record");

  if (!allowed) return <Alert variant="error" title="You don't have permission to view meters." />;

  const rowErrors: Record<string, string> =
    bulk.error instanceof ApiError
      ? Object.fromEntries(
          Object.entries((bulk.error.details.readings as unknown as Record<string, string[]>) ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v[0]! : String(v)]),
        )
      : {};
  const entered = (meters.data?.results ?? []).filter((m) => values[m.id]?.trim());

  const submit = () =>
    bulk.mutate(
      { reading_date: date, readings: entered.map((m) => ({ meter: m.id, value: values[m.id]!.trim() })) },
      {
        onSuccess: (saved) => {
          toast.success(`${saved.length} readings saved`);
          setValues({});
        },
      },
    );

  return (
    <>
      <PageHeader
        title="Utilities"
        description="Meters and readings. Usage between consecutive readings is billed once, at the unit's metered rate."
        actions={
          canRecord && (
            <Button variant="outline" onClick={() => setAdding(true)} disabled={!propertyId}>
              <Plus /> Add meter
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <NativeSelect aria-label="Property" className="sm:w-64" value={propertyId} onChange={(e) => { setChosen(e.target.value); setValues({}); }}>
          {properties.data?.results.length === 0 && <option value="">No properties</option>}
          {properties.data?.results.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="Utility" className="sm:w-48" value={utility} onChange={(e) => { setUtility(e.target.value as MeterUtility | ""); setValues({}); }}>
          <option value="">All utilities</option>
          {Object.entries(METER_UTILITY).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </NativeSelect>
        {canRecord && (
          <div className="sm:ml-auto sm:w-48">
            <Input type="date" aria-label="Reading date" max={todayIn(current.organization.timezone)} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        )}
      </div>

      {bulk.isError && Object.keys(rowErrors).length === 0 && <Alert variant="error" className="mb-4" title={bulk.error.message} />}
      {Object.keys(rowErrors).length > 0 && (
        <Alert variant="error" className="mb-4" title="Some readings need fixing. Nothing was saved." />
      )}

      {!propertyId ? (
        <EmptyState icon={Gauge} title="No properties" description="Add a property first." />
      ) : meters.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : meters.isError ? (
        <ErrorState message={errorMessage(meters.error)} onRetry={() => meters.refetch()} />
      ) : meters.data.results.length === 0 ? (
        <EmptyState icon={Gauge} title="No meters here yet" description="Add a meter to a unit to start recording readings." />
      ) : (
        <>
          <div className="rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Unit</TableHead>
                  <TableHead className="hidden sm:table-cell">Meter</TableHead>
                  <TableHead>Last reading</TableHead>
                  {canRecord && <TableHead className="w-40">New reading</TableHead>}
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {meters.data.results.map((m, index) => {
                  const error = rowErrors[String(entered.findIndex((e) => e.id === m.id))];
                  return (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium">{m.unit_number}</TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {METER_UTILITY[m.utility]}
                        {m.number && <p className="text-xs text-muted-foreground">{m.number}</p>}
                      </TableCell>
                      <TableCell>
                        {m.last_reading_value ? (
                          <>
                            {Number(m.last_reading_value)}
                            <p className="text-xs text-muted-foreground">{formatDay(m.last_reading_date)}</p>
                          </>
                        ) : (
                          <span className="text-muted-foreground">None yet</span>
                        )}
                      </TableCell>
                      {canRecord && (
                        <TableCell>
                          <Input
                            aria-label={`New reading for ${m.unit_number} ${METER_UTILITY[m.utility]}`}
                            inputMode="decimal"
                            value={values[m.id] ?? ""}
                            aria-invalid={error ? true : undefined}
                            tabIndex={index + 1}
                            onChange={(e) => setValues({ ...values, [m.id]: e.target.value })}
                          />
                          {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
                        </TableCell>
                      )}
                      <TableCell>
                        <Button variant="ghost" size="icon" aria-label={`Reading history for ${m.unit_number}`} onClick={() => setHistory(m)}>
                          <History />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {canRecord && (
            <div className="mt-4 flex items-center justify-end gap-3">
              <p className="text-sm text-muted-foreground">
                {entered.length} reading{entered.length === 1 ? "" : "s"} for {formatDay(date)}
              </p>
              <Button disabled={entered.length === 0 || !date} loading={bulk.isPending} onClick={submit}>
                Save readings
              </Button>
            </div>
          )}
        </>
      )}
      <AddMeterDialog open={adding} onOpenChange={setAdding} propertyId={propertyId} />
      <HistoryDialog meter={history} onClose={() => setHistory(null)} />
    </>
  );
}

function AddMeterDialog({ open, onOpenChange, propertyId }: { open: boolean; onOpenChange: (o: boolean) => void; propertyId: string }) {
  const units = useUnits({ property: propertyId, page_size: 100 }, open && Boolean(propertyId));
  const create = useCreateMeter();
  const [unit, setUnit] = React.useState("");
  const [utility, setUtility] = React.useState<MeterUtility>("water");
  const [number, setNumber] = React.useState("");
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) create.reset(); onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a meter</DialogTitle>
          <DialogDescription>Record a first reading as the baseline; usage is billed from the second reading on.</DialogDescription>
        </DialogHeader>
        {create.isError && <Alert variant="error" title={create.error.message} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="m-unit" label="Unit">
            <NativeSelect value={unit} onChange={(e) => setUnit(e.target.value)}>
              <option value="">Choose…</option>
              {units.data?.results.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.number}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField id="m-utility" label="Utility">
            <NativeSelect value={utility} onChange={(e) => setUtility(e.target.value as MeterUtility)}>
              {Object.entries(METER_UTILITY).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        </div>
        <FormField id="m-number" label="Meter number (optional)">
          <Input value={number} maxLength={64} onChange={(e) => setNumber(e.target.value)} />
        </FormField>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!unit}
            loading={create.isPending}
            onClick={() =>
              create.mutate(
                { unit, utility, number },
                {
                  onSuccess: () => {
                    toast.success("Meter added");
                    setUnit("");
                    setNumber("");
                    onOpenChange(false);
                  },
                },
              )
            }
          >
            Add meter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HistoryDialog({ meter, onClose }: { meter: Meter | null; onClose: () => void }) {
  const { can } = useOrganization();
  const readings = useReadings(meter?.id, meter !== null);
  const remove = useDeleteReading();
  const deactivate = useDeactivateMeter();
  const list = readings.data?.results ?? [];
  return (
    <Dialog open={meter !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {meter && `${METER_UTILITY[meter.utility]} · Unit ${meter.unit_number}`}
          </DialogTitle>
          <DialogDescription>Billed readings are locked. Delete a mistaken reading before it is billed.</DialogDescription>
        </DialogHeader>
        {readings.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground">No readings yet.</p>
        ) : (
          <ul className="max-h-80 divide-y overflow-y-auto rounded-lg border text-sm">
            {list.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div>
                  <p className="font-medium">{Number(r.value)}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDay(r.reading_date)}
                    {r.recorded_by_name && ` · ${r.recorded_by_name}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {r.is_billed ? <Badge variant="default">Billed</Badge> : <Badge variant="outline">Not billed</Badge>}
                  {can("meters.record") && !r.is_billed && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive"
                      aria-label="Delete reading"
                      disabled={remove.isPending}
                      onClick={() =>
                        remove.mutate(r.id, {
                          onSuccess: () => toast.success("Reading deleted"),
                          onError: (e) => toast.error(errorMessage(e)),
                        })
                      }
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {can("meters.record") && meter && (
          <DialogFooter>
            <Button
              variant="outline"
              loading={deactivate.isPending}
              onClick={() =>
                deactivate.mutate(meter.id, {
                  onSuccess: () => {
                    toast.success("Meter deactivated");
                    onClose();
                  },
                  onError: (e) => toast.error(errorMessage(e)),
                })
              }
            >
              Deactivate meter (replaced)
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
