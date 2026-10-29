"use client";

import { ClipboardCheck, Plus } from "lucide-react";
import Link from "next/link";
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
import { Pagination } from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useInspections, useScheduleInspection } from "@/features/inspections/api";
import { usePropertyOptions, useUnits } from "@/features/properties/api";
import { useMembers } from "@/features/team/api";
import { errorMessage } from "@/lib/api/errors";
import { INSPECTION_KIND, INSPECTION_STATUS } from "@/lib/labels";
import { formatDay, formatMoney, todayIn } from "@/lib/utils";
import type { InspectionKind } from "@/types/api";

export function InspectionsPage() {
  const { can, current } = useOrganization();
  const [status, setStatus] = React.useState("scheduled");
  const [kind, setKind] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [creating, setCreating] = React.useState(false);
  const allowed = can("inspections.view");
  const list = useInspections({ status, kind, page }, allowed);

  if (!allowed) return <Alert variant="error" title="You don't have permission to view inspections." />;
  const currency = current.organization.currency;

  return (
    <>
      <PageHeader
        title="Inspections"
        description="Move-in, move-out and routine unit inspections."
        actions={can("inspections.manage") && <Button onClick={() => setCreating(true)}><Plus /> Schedule inspection</Button>}
      />
      <div className="mb-4 flex flex-col gap-3 md:flex-row">
        <NativeSelect aria-label="Status" className="md:w-44" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">Any status</option>
          {Object.entries(INSPECTION_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </NativeSelect>
        <NativeSelect aria-label="Kind" className="md:w-44" value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }}>
          <option value="">Any kind</option>
          {Object.entries(INSPECTION_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </NativeSelect>
      </div>
      {list.isPending ? (
        <Skeleton className="h-72 w-full" />
      ) : list.isError ? (
        <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
      ) : list.data.results.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title={status === "scheduled" ? "No upcoming inspections" : "Nothing here"} description="Move-out inspections are scheduled from the move-out notice." />
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Inspection</TableHead>
                <TableHead className="hidden md:table-cell">Where</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden text-right lg:table-cell">Damages</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.results.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>
                    <Link href={`/dashboard/inspections/${i.id}`} className="font-medium hover:underline">{INSPECTION_KIND[i.kind]} · {i.reference}</Link>
                    <p className="text-xs text-muted-foreground">{i.inspector_name ? `Inspector: ${i.inspector_name}` : "No inspector assigned"}</p>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {i.property_name} · {i.unit_number}
                    {i.tenant_name && <p className="text-xs text-muted-foreground">{i.tenant_name}</p>}
                  </TableCell>
                  <TableCell>{formatDay(i.scheduled_for)}</TableCell>
                  <TableCell><Badge variant={INSPECTION_STATUS[i.status].variant}>{INSPECTION_STATUS[i.status].label}</Badge></TableCell>
                  <TableCell className="hidden text-right lg:table-cell">{Number(i.damages_total) > 0 ? formatMoney(i.damages_total, currency) : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {list.data && <Pagination page={page} pageSize={25} count={list.data.count} onPageChange={setPage} />}
      <ScheduleDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

function ScheduleDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { can, current } = useOrganization();
  const properties = usePropertyOptions(open);
  const members = useMembers({}, open && can("members.view"));
  const [property, setProperty] = React.useState("");
  const units = useUnits({ property, page_size: 100 }, Boolean(property));
  const schedule = useScheduleInspection();
  const today = todayIn(current.organization.timezone);
  const blank = { unit: "", kind: "routine" as InspectionKind, scheduled_for: today, inspector: "" };
  const [form, setForm] = React.useState(blank);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) schedule.reset(); onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Schedule an inspection</DialogTitle>
          <DialogDescription>A standard checklist is added. For move-in and move-out inspections the tenant is notified.</DialogDescription>
        </DialogHeader>
        {schedule.isError && <Alert variant="error" title={schedule.error.message} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="i-prop" label="Property">
            <NativeSelect value={property} onChange={(e) => { setProperty(e.target.value); set("unit", ""); }}>
              <option value="">Choose…</option>
              {properties.data?.results.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </NativeSelect>
          </FormField>
          <FormField id="i-unit" label="Unit">
            <NativeSelect value={form.unit} disabled={!property} onChange={(e) => set("unit", e.target.value)}>
              <option value="">Choose…</option>
              {units.data?.results.map((u) => <option key={u.id} value={u.id}>{u.number}</option>)}
            </NativeSelect>
          </FormField>
          <FormField id="i-kind" label="Kind">
            <NativeSelect value={form.kind} onChange={(e) => set("kind", e.target.value as InspectionKind)}>
              {Object.entries(INSPECTION_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </NativeSelect>
          </FormField>
          <FormField id="i-date" label="Date">
            <Input type="date" value={form.scheduled_for} onChange={(e) => set("scheduled_for", e.target.value)} />
          </FormField>
          {members.data && (
            <FormField id="i-insp" label="Inspector (optional)">
              <NativeSelect value={form.inspector} onChange={(e) => set("inspector", e.target.value)}>
                <option value="">Not assigned</option>
                {members.data.results.map((m) => <option key={m.id} value={m.id}>{m.user.full_name}</option>)}
              </NativeSelect>
            </FormField>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!form.unit || !form.scheduled_for}
            loading={schedule.isPending}
            onClick={() => schedule.mutate({ ...form, inspector: form.inspector || null }, {
              onSuccess: (i) => {
                toast.success(`${i.reference} scheduled`);
                setForm(blank);
                onOpenChange(false);
              },
            })}
          >
            Schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
