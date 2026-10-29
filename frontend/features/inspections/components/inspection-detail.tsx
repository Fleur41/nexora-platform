"use client";

import { ArrowLeft, Check, Plus, X } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

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
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { Textarea } from "@/components/ui/textarea";
import { DocumentsPanel } from "@/features/documents/components/documents-panel";
import { useInspection, useInspectionAction, useSaveInspectionItems } from "@/features/inspections/api";
import { ApiError, errorMessage } from "@/lib/api/errors";
import { INSPECTION_KIND, INSPECTION_STATUS, ITEM_CONDITION } from "@/lib/labels";
import { formatDateTime, formatDay, formatMoney } from "@/lib/utils";
import type { InspectionDetail as Detail, InspectionItem, ItemCondition } from "@/types/api";

type Draft = Pick<InspectionItem, "condition" | "notes" | "charge_amount">;

// Notes and charges are only asked for when something is wrong (or already recorded).
const needsDetail = (v: Draft) =>
  !["not_checked", "good"].includes(v.condition) || Boolean(v.notes) || Number(v.charge_amount) > 0;

export function InspectionDetail() {
  const { id } = useParams<{ id: string }>();
  const { can, current } = useOrganization();
  const inspection = useInspection(id);
  const action = useInspectionAction();
  const [completing, setCompleting] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);

  if (inspection.isPending) return <Skeleton className="h-96 w-full" />;
  if (inspection.isError) {
    return <ErrorState message={inspection.error instanceof ApiError && inspection.error.status === 404 ? "This inspection doesn't exist or you don't have access to it." : errorMessage(inspection.error)} />;
  }
  const i = inspection.data;
  const editable = can("inspections.manage") && i.status === "scheduled";
  const tz = current.organization.timezone;

  return (
    <>
      <Link href="/dashboard/inspections" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Inspections
      </Link>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{INSPECTION_KIND[i.kind]} inspection</h1>
            <Badge variant={INSPECTION_STATUS[i.status].variant}>{INSPECTION_STATUS[i.status].label}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {i.reference} · {i.property_name} unit {i.unit_number} · {formatDay(i.scheduled_for)}
            {i.lease && <> · <Link className="hover:underline" href={`/dashboard/leases/${i.lease}`}>{i.lease_reference}</Link></>}
            {i.tenant_name && <> · {i.tenant_name}</>}
          </p>
        </div>
        {editable && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setCancelling(true)}><X /> Cancel inspection</Button>
            <Button size="sm" onClick={() => setCompleting(true)}><Check /> Complete</Button>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Checklist inspection={i} editable={editable} />
          <Card>
            <CardHeader><CardTitle>Photos &amp; files</CardTitle></CardHeader>
            <CardContent>
              <DocumentsPanel target="inspection" targetId={i.id} canManage={can("inspections.manage")} categories={["photo", "inspection", "other"]} gallery />
            </CardContent>
          </Card>
        </div>
        <Card className="h-fit">
          <CardHeader><CardTitle>Summary</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>Inspector: {i.inspector_name ?? "not assigned"}</p>
            {i.kind === "move_out" && <p>Damage charges: <strong>{formatMoney(i.damages_total, current.organization.currency)}</strong></p>}
            {i.status === "completed" && (
              <>
                <p>Completed {i.completed_at && formatDateTime(i.completed_at, tz)}</p>
                {i.keys_returned !== null && <p>Keys returned: {i.keys_returned}</p>}
                <p>Tenant present: {i.tenant_present ? "yes" : "no"}</p>
                <p>Signed by inspector: {i.inspector_signature_name}</p>
                {i.tenant_signature_name && <p>Signed by tenant: {i.tenant_signature_name}</p>}
                {i.summary && <p className="whitespace-pre-line border-t pt-2">{i.summary}</p>}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <CompleteDialog inspection={i} open={completing} onOpenChange={setCompleting} />
      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title={`Cancel ${i.reference}?`}
        description="The checklist is kept for the record but can no longer be edited."
        confirmLabel="Cancel inspection"
        destructive
        loading={action.isPending}
        onConfirm={() => action.mutate({ id: i.id, action: "cancel" }, {
          onSuccess: () => { setCancelling(false); toast.success("Inspection cancelled"); },
          onError: (e) => toast.error(errorMessage(e)),
        })}
      />
    </>
  );
}

function Checklist({ inspection: i, editable }: { inspection: Detail; editable: boolean }) {
  const { current } = useOrganization();
  const save = useSaveInspectionItems();
  const [drafts, setDrafts] = React.useState<Record<string, Draft>>({});
  const [newItem, setNewItem] = React.useState({ area: "", name: "" });
  const damages = i.kind === "move_out";
  const areas = React.useMemo(() => {
    const groups = new Map<string, InspectionItem[]>();
    for (const item of [...i.items].sort((a, b) => a.position - b.position)) {
      groups.set(item.area, [...(groups.get(item.area) ?? []), item]);
    }
    return [...groups.entries()];
  }, [i.items]);
  const value = (item: InspectionItem): Draft => drafts[item.id] ?? item;
  const edit = (item: InspectionItem, patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [item.id]: { ...value(item), ...patch } }));
  const dirty = Object.keys(drafts).length > 0;
  const unchecked = i.items.filter((item) => value(item).condition === "not_checked").length;

  const submit = (items: object[], done: string, after?: () => void) =>
    save.mutate({ id: i.id, items }, {
      onSuccess: () => { setDrafts({}); after?.(); toast.success(done); },
      onError: (e) => toast.error(errorMessage(e)),
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Checklist</CardTitle>
        <CardDescription>
          {unchecked > 0 ? `${unchecked} of ${i.items.length} items still to check.` : "Every item has been checked."}
          {damages && " Charges entered here are deducted from the deposit at settlement."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {areas.map(([area, items]) => (
          <section key={area}>
            <h3 className="mb-2 text-sm font-semibold">{area}</h3>
            <ul className="divide-y rounded-lg border">
              {items.map((item) => {
                const v = value(item);
                return (
                  <li key={item.id} className="grid gap-2 p-3 text-sm sm:grid-cols-[1fr_9rem] sm:items-center">
                    <span className="font-medium">{item.name}</span>
                    {editable ? (
                      <NativeSelect aria-label={`${item.name} condition`} value={v.condition} onChange={(e) => edit(item, { condition: e.target.value as ItemCondition })}>
                        {Object.entries(ITEM_CONDITION).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                      </NativeSelect>
                    ) : (
                      <Badge variant={v.condition === "damaged" || v.condition === "missing" ? "destructive" : v.condition === "poor" ? "warning" : "outline"} className="w-fit">
                        {ITEM_CONDITION[v.condition]}
                      </Badge>
                    )}
                    {editable ? (
                      needsDetail(v) && <div className={`grid gap-2 sm:col-span-2 ${damages ? "sm:grid-cols-[1fr_9rem]" : ""}`}>
                        <Input aria-label={`${item.name} notes`} placeholder="Notes" value={v.notes} onChange={(e) => edit(item, { notes: e.target.value })} />
                        {damages && (
                          <Input aria-label={`${item.name} charge`} inputMode="decimal" placeholder="Charge" value={Number(v.charge_amount) ? v.charge_amount : ""}
                            onChange={(e) => edit(item, { charge_amount: e.target.value || "0" })} />
                        )}
                      </div>
                    ) : (
                      (v.notes || Number(v.charge_amount) > 0) && (
                        <p className="text-muted-foreground sm:col-span-2">
                          {v.notes}
                          {Number(v.charge_amount) > 0 && <> · charge {formatMoney(v.charge_amount, current.organization.currency)}</>}
                        </p>
                      )
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        {editable && (
          <>
            <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row">
              <Input aria-label="New item area" placeholder="Area (e.g. Balcony)" value={newItem.area} onChange={(e) => setNewItem({ ...newItem, area: e.target.value })} />
              <Input aria-label="New item name" placeholder="Item (e.g. Railing)" value={newItem.name} onChange={(e) => setNewItem({ ...newItem, name: e.target.value })} />
              <Button variant="outline" disabled={!newItem.area.trim() || !newItem.name.trim() || dirty} loading={save.isPending}
                title={dirty ? "Save your changes first" : undefined}
                onClick={() => submit([{ area: newItem.area.trim(), name: newItem.name.trim() }], "Item added", () => setNewItem({ area: "", name: "" }))}>
                <Plus /> Add item
              </Button>
            </div>
            <div className="flex justify-end gap-2">
              {dirty && <Button variant="ghost" onClick={() => setDrafts({})}>Discard changes</Button>}
              <Button disabled={!dirty} loading={save.isPending}
                onClick={() => submit(Object.entries(drafts).map(([id, d]) => ({ id, ...d })), "Checklist saved")}>
                Save checklist
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function CompleteDialog({ inspection: i, open, onOpenChange }: { inspection: Detail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const action = useInspectionAction();
  const [form, setForm] = React.useState({ summary: "", keys_returned: "", tenant_present: false, tenant_signature_name: "", inspector_signature_name: "" });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) action.reset(); onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Complete {i.reference}</DialogTitle>
          <DialogDescription>Save the checklist first. Once completed, the inspection can no longer be edited.</DialogDescription>
        </DialogHeader>
        {action.isError && <Alert variant="error" title={action.error.message} />}
        <FormField id="c-summary" label="Summary (optional)">
          <Textarea rows={3} value={form.summary} onChange={(e) => set("summary", e.target.value)} />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="c-keys" label="Keys returned (optional)">
            <Input type="number" min={0} max={50} value={form.keys_returned} onChange={(e) => set("keys_returned", e.target.value)} />
          </FormField>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={form.tenant_present} onChange={(e) => set("tenant_present", e.target.checked)} />
            Tenant was present
          </label>
          <FormField id="c-insp-sign" label="Inspector signature" hint="Type your full name.">
            <Input value={form.inspector_signature_name} onChange={(e) => set("inspector_signature_name", e.target.value)} />
          </FormField>
          <FormField id="c-tenant-sign" label="Tenant signature (optional)">
            <Input value={form.tenant_signature_name} disabled={!form.tenant_present} onChange={(e) => set("tenant_signature_name", e.target.value)} />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Back</Button>
          <Button
            disabled={!form.inspector_signature_name.trim()}
            loading={action.isPending}
            onClick={() => action.mutate({
              id: i.id,
              action: "complete",
              body: {
                ...form,
                keys_returned: form.keys_returned === "" ? null : Number(form.keys_returned),
                tenant_signature_name: form.tenant_present ? form.tenant_signature_name : "",
              },
            }, { onSuccess: () => { toast.success("Inspection completed"); onOpenChange(false); } })}
          >
            Complete inspection
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
