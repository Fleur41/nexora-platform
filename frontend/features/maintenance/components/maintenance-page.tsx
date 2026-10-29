"use client";

import { Plus, Search, Wrench } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { useCreateMaintenance, useMaintenanceList } from "@/features/maintenance/api";
import { usePropertyOptions, useUnits } from "@/features/properties/api";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { errorMessage } from "@/lib/api/errors";
import { MAINTENANCE_CATEGORY, MAINTENANCE_STATUS, URGENCY } from "@/lib/labels";
import { formatDateTime } from "@/lib/utils";
import type { MaintenanceCategory, MaintenanceStatus, Urgency } from "@/types/api";

type View = "open" | "mine" | "all";

export function MaintenancePage() {
  const { can, current } = useOrganization();
  const [view, setView] = React.useState<View>("open");
  const [status, setStatus] = React.useState<MaintenanceStatus | "">("");
  const [urgency, setUrgency] = React.useState<Urgency | "">("");
  const [search, setSearch] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [creating, setCreating] = React.useState(false);
  const debounced = useDebouncedValue(search, 300);
  const allowed = can("maintenance.view");
  const list = useMaintenanceList(
    { search: debounced, page, urgency, status: view === "all" ? status : "", open: view === "open" || undefined, mine: view === "mine" || undefined },
    allowed,
  );

  if (!allowed) return <Alert variant="error" title="You don't have permission to view maintenance." />;
  const reset = () => setPage(1);

  return (
    <>
      <PageHeader
        title="Maintenance"
        description="Repairs reported by tenants and staff."
        actions={can("maintenance.manage") && <Button onClick={() => setCreating(true)}><Plus /> New request</Button>}
      />
      <div className="mb-4 flex flex-col gap-3 md:flex-row">
        <NativeSelect aria-label="View" className="md:w-44" value={view} onChange={(e) => { setView(e.target.value as View); reset(); }}>
          <option value="open">Open</option>
          <option value="mine">Assigned to me</option>
          <option value="all">All</option>
        </NativeSelect>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input aria-label="Search maintenance" placeholder="Search reference, title, unit or tenant" className="pl-9" value={search} onChange={(e) => { setSearch(e.target.value); reset(); }} />
        </div>
        <NativeSelect aria-label="Urgency" className="md:w-40" value={urgency} onChange={(e) => { setUrgency(e.target.value as Urgency | ""); reset(); }}>
          <option value="">Any urgency</option>
          {Object.entries(URGENCY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </NativeSelect>
        {view === "all" && (
          <NativeSelect aria-label="Status" className="md:w-44" value={status} onChange={(e) => { setStatus(e.target.value as MaintenanceStatus | ""); reset(); }}>
            <option value="">Any status</option>
            {Object.entries(MAINTENANCE_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </NativeSelect>
        )}
      </div>
      {list.isPending ? (
        <Skeleton className="h-72 w-full" />
      ) : list.isError ? (
        <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
      ) : list.data.results.length === 0 ? (
        <EmptyState icon={Wrench} title={view === "open" ? "No open requests" : "Nothing here"} description="Requests tenants report from their portal appear here too." />
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Request</TableHead>
                <TableHead className="hidden md:table-cell">Where</TableHead>
                <TableHead>Urgency</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden lg:table-cell">Assigned</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.results.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link href={`/dashboard/maintenance/${r.id}`} className="font-medium hover:underline">{r.title}</Link>
                    <p className="text-xs text-muted-foreground">
                      {r.reference} · {MAINTENANCE_CATEGORY[r.category]} · {formatDateTime(r.created_at, current.organization.timezone)}
                      {r.source === "tenant" && " · from tenant"}
                    </p>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {r.property_name} · {r.unit_number}
                    {r.tenant_name && <p className="text-xs text-muted-foreground">{r.tenant_name}</p>}
                  </TableCell>
                  <TableCell><Badge variant={URGENCY[r.urgency].variant}>{URGENCY[r.urgency].label}</Badge></TableCell>
                  <TableCell><Badge variant={MAINTENANCE_STATUS[r.status].variant}>{MAINTENANCE_STATUS[r.status].label}</Badge></TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">{r.assigned_to_name ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {list.data && <Pagination page={page} pageSize={25} count={list.data.count} onPageChange={setPage} />}
      <NewRequestDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

function NewRequestDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const properties = usePropertyOptions(open);
  const [property, setProperty] = React.useState("");
  const units = useUnits({ property, page_size: 100 }, Boolean(property));
  const create = useCreateMaintenance();
  const [form, setForm] = React.useState({ unit: "", category: "plumbing" as MaintenanceCategory, title: "", description: "", urgency: "normal" as Urgency });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) create.reset(); onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New maintenance request</DialogTitle>
          <DialogDescription>The tenant of the unit (if any) is linked automatically and kept informed.</DialogDescription>
        </DialogHeader>
        {create.isError && <Alert variant="error" title={create.error.message} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="m-prop" label="Property">
            <NativeSelect value={property} onChange={(e) => { setProperty(e.target.value); set("unit", ""); }}>
              <option value="">Choose…</option>
              {properties.data?.results.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </NativeSelect>
          </FormField>
          <FormField id="m-unit" label="Unit">
            <NativeSelect value={form.unit} disabled={!property} onChange={(e) => set("unit", e.target.value)}>
              <option value="">Choose…</option>
              {units.data?.results.map((u) => <option key={u.id} value={u.id}>{u.number}</option>)}
            </NativeSelect>
          </FormField>
          <FormField id="m-cat" label="Category">
            <NativeSelect value={form.category} onChange={(e) => set("category", e.target.value as MaintenanceCategory)}>
              {Object.entries(MAINTENANCE_CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </NativeSelect>
          </FormField>
          <FormField id="m-urg" label="Urgency">
            <NativeSelect value={form.urgency} onChange={(e) => set("urgency", e.target.value as Urgency)}>
              {Object.entries(URGENCY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </NativeSelect>
          </FormField>
        </div>
        <FormField id="m-title" label="What's wrong?">
          <Input maxLength={160} value={form.title} onChange={(e) => set("title", e.target.value)} />
        </FormField>
        <FormField id="m-desc" label="Details">
          <Textarea rows={3} value={form.description} onChange={(e) => set("description", e.target.value)} />
        </FormField>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!form.unit || !form.title.trim() || !form.description.trim()}
            loading={create.isPending}
            onClick={() => create.mutate(form, {
              onSuccess: (r) => {
                toast.success(`${r.reference} created`);
                setForm({ unit: "", category: "plumbing", title: "", description: "", urgency: "normal" });
                onOpenChange(false);
              },
            })}
          >
            Create request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
