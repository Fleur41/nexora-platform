"use client";

import { Plus } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePlatformPlans, useSavePlan } from "@/features/platform/api";
import { errorMessage } from "@/lib/api/errors";
import { formatMoney } from "@/lib/utils";
import type { Plan } from "@/types/api";

export function PlatformPlans() {
  const plans = usePlatformPlans();
  const [editing, setEditing] = React.useState<Partial<Plan> | null>(null);
  return (
    <>
      <PageHeader title="Plans" description="What organizations can subscribe to. Price changes apply to invoices issued from now on."
        actions={<Button onClick={() => setEditing({ currency: "KES", is_active: true, sort_order: 50 })}><Plus /> New plan</Button>} />
      <Card>
        <CardContent className="px-0 pt-2">
          {plans.isPending ? (
            <div className="p-6"><Skeleton className="h-48 w-full" /></div>
          ) : plans.isError ? (
            <div className="p-6"><ErrorState message={errorMessage(plans.error)} onRetry={() => plans.refetch()} /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plan</TableHead>
                  <TableHead className="text-right">Units</TableHead>
                  <TableHead className="text-right">Monthly price</TableHead>
                  <TableHead className="text-right">Organizations</TableHead>
                  <TableHead><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plans.data.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <span className="font-medium">{p.name}</span> <span className="font-mono text-xs text-muted-foreground">{p.code}</span>
                      {!p.is_active && <Badge variant="muted" className="ml-2">Hidden</Badge>}
                      <p className="text-xs text-muted-foreground">{p.description}</p>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{p.max_units ?? "Unlimited"}</TableCell>
                    <TableCell className="text-right tabular-nums">{Number(p.monthly_price) > 0 ? formatMoney(p.monthly_price, p.currency) : "By agreement"}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.organizations}</TableCell>
                    <TableCell className="text-right"><Button size="sm" variant="outline" onClick={() => setEditing(p)}>Edit</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {editing && <PlanDialog plan={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function PlanDialog({ plan, onClose }: { plan: Partial<Plan>; onClose: () => void }) {
  const save = useSavePlan();
  const [form, setForm] = React.useState({
    code: plan.code ?? "",
    name: plan.name ?? "",
    description: plan.description ?? "",
    max_units: plan.max_units?.toString() ?? "",
    monthly_price: plan.monthly_price ?? "",
    sort_order: String(plan.sort_order ?? 50),
    is_active: plan.is_active ?? true,
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save.mutate(
      {
        id: plan.id,
        ...(plan.id ? {} : { code: form.code.trim(), currency: plan.currency }),
        name: form.name.trim(),
        description: form.description.trim(),
        max_units: form.max_units ? Number(form.max_units) : null,
        monthly_price: form.monthly_price || "0",
        sort_order: Number(form.sort_order) || 0,
        is_active: form.is_active,
      },
      { onSuccess: () => { toast.success("Plan saved"); onClose(); }, onError: (err) => toast.error(errorMessage(err)) },
    );
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{plan.id ? `Edit ${plan.name}` : "New plan"}</DialogTitle>
            <DialogDescription>Leave units empty for unlimited. A price of 0 means priced by agreement: never invoiced automatically.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            {!plan.id && <FormField id="plan-code" label="Code" hint="Lowercase, never changes"><Input value={form.code} onChange={(e) => set("code", e.target.value)} required pattern="[a-z0-9_-]+" /></FormField>}
            <FormField id="plan-name" label="Name"><Input value={form.name} onChange={(e) => set("name", e.target.value)} required /></FormField>
            <FormField id="plan-units" label="Unit limit"><Input type="number" min={1} value={form.max_units} onChange={(e) => set("max_units", e.target.value)} placeholder="Unlimited" /></FormField>
            <FormField id="plan-price" label={`Monthly price (${plan.currency ?? "KES"})`}><Input type="number" min={0} step="0.01" value={form.monthly_price} onChange={(e) => set("monthly_price", e.target.value)} required /></FormField>
            <FormField id="plan-order" label="Order on the plans page"><Input type="number" value={form.sort_order} onChange={(e) => set("sort_order", e.target.value)} /></FormField>
          </div>
          <FormField id="plan-description" label="Description"><Input value={form.description} onChange={(e) => set("description", e.target.value)} /></FormField>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={form.is_active} onChange={(e) => set("is_active", e.target.checked)} />
            Offered to organizations
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={save.isPending}>Save plan</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
