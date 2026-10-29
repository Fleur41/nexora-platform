"use client";

import { LogOut, Plus, Search } from "lucide-react";
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
import { useLeases } from "@/features/leases/api";
import { useGiveNotice, useMoveOuts } from "@/features/moveouts/api";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { errorMessage } from "@/lib/api/errors";
import { MOVE_OUT_STATUS } from "@/lib/labels";
import { formatDay, todayIn } from "@/lib/utils";

export function MoveOutsPage() {
  const { can } = useOrganization();
  const [open, setOpen] = React.useState(true);
  const [page, setPage] = React.useState(1);
  const [giving, setGiving] = React.useState(false);
  const allowed = can("moveouts.view");
  const list = useMoveOuts({ open: open || undefined, page }, allowed);

  if (!allowed) return <Alert variant="error" title="You don't have permission to view move-outs." />;

  return (
    <>
      <PageHeader
        title="Move-outs"
        description="Notices to vacate, inspections and final settlement. Notices stay private until acknowledged; the unit is not advertised as available."
        actions={can("moveouts.manage") && <Button onClick={() => setGiving(true)}><Plus /> Record notice</Button>}
      />
      <div className="mb-4">
        <NativeSelect aria-label="View" className="md:w-44" value={open ? "open" : "all"} onChange={(e) => { setOpen(e.target.value === "open"); setPage(1); }}>
          <option value="open">Open</option>
          <option value="all">All</option>
        </NativeSelect>
      </div>
      {list.isPending ? (
        <Skeleton className="h-72 w-full" />
      ) : list.isError ? (
        <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
      ) : list.data.results.length === 0 ? (
        <EmptyState icon={LogOut} title={open ? "No open move-outs" : "Nothing here"} description="Notices tenants give from their portal appear here too." />
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tenant</TableHead>
                <TableHead className="hidden md:table-cell">Where</TableHead>
                <TableHead>Moving out</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.results.map((n) => (
                <TableRow key={n.id}>
                  <TableCell>
                    <Link href={`/dashboard/move-outs/${n.id}`} className="font-medium hover:underline">{n.tenant_name}</Link>
                    <p className="text-xs text-muted-foreground">{n.lease_reference}{n.from_tenant && " · from tenant"}</p>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{n.property_name} · {n.unit_number}</TableCell>
                  <TableCell>{formatDay(n.intended_date)}</TableCell>
                  <TableCell><Badge variant={MOVE_OUT_STATUS[n.status].variant}>{MOVE_OUT_STATUS[n.status].label}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {list.data && <Pagination page={page} pageSize={25} count={list.data.count} onPageChange={setPage} />}
      <GiveNoticeDialog open={giving} onOpenChange={setGiving} />
    </>
  );
}

export function GiveNoticeDialog({ open, onOpenChange, lease: fixedLease }: { open: boolean; onOpenChange: (o: boolean) => void; lease?: { id: string; label: string } }) {
  const { current } = useOrganization();
  const today = todayIn(current.organization.timezone);
  const [search, setSearch] = React.useState("");
  const debounced = useDebouncedValue(search, 300);
  const leases = useLeases({ status: "active", search: debounced, page_size: 20 }, open && !fixedLease);
  const give = useGiveNotice();
  const blank = { lease: fixedLease?.id ?? "", intended_date: today, message: "" };
  const [form, setForm] = React.useState(blank);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) give.reset(); onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record a move-out notice</DialogTitle>
          <DialogDescription>For notice given in person, by phone or in writing. The unit is marked “notice submitted” only once you acknowledge it.</DialogDescription>
        </DialogHeader>
        {give.isError && <Alert variant="error" title={give.error.message} />}
        {fixedLease ? (
          <p className="text-sm">Lease: <strong>{fixedLease.label}</strong></p>
        ) : (
          <>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input aria-label="Search active leases" placeholder="Search tenant, unit or lease" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <FormField id="g-lease" label="Active lease">
              <NativeSelect value={form.lease} onChange={(e) => set("lease", e.target.value)}>
                <option value="">Choose…</option>
                {leases.data?.results.map((l) => (
                  <option key={l.id} value={l.id}>{l.tenant_name} · {l.property_name} {l.unit_number} ({l.reference})</option>
                ))}
              </NativeSelect>
            </FormField>
          </>
        )}
        <FormField id="g-date" label="Planned move-out date">
          <Input type="date" min={today} value={form.intended_date} onChange={(e) => set("intended_date", e.target.value)} />
        </FormField>
        <FormField id="g-msg" label="Notes from the tenant (optional)">
          <Textarea rows={3} value={form.message} onChange={(e) => set("message", e.target.value)} />
        </FormField>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!form.lease || !form.intended_date}
            loading={give.isPending}
            onClick={() => give.mutate(form, {
              onSuccess: () => {
                toast.success("Move-out notice recorded");
                setForm(blank);
                onOpenChange(false);
              },
            })}
          >
            Record notice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
