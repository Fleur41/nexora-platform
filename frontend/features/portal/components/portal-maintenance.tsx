"use client";

import { ArrowLeft, Camera, ChevronRight, ImagePlus, Plus, Send, Wrench, X } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormField } from "@/components/ui/form-field";
import { Input, NativeSelect } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Textarea } from "@/components/ui/textarea";
import {
  useAddRepairPhotos,
  useMaintenanceMessage,
  usePortalMaintenance,
  usePortalMaintenanceList,
  usePortalPhoto,
  usePortalSummary,
  useReportIssue,
} from "@/features/portal/api";
import { useTenancy } from "@/features/portal/tenancy";
import { ApiError, errorMessage } from "@/lib/api/errors";
import { MAINTENANCE_CATEGORY, MAINTENANCE_STATUS, URGENCY } from "@/lib/labels";
import { formatDateTime, formatDay } from "@/lib/utils";
import type { MaintenanceCategory, MaintenanceStatus, Urgency } from "@/types/api";

/** What each status means to a tenant (staff labels are written for staff). */
const TENANT_STATUS: Record<MaintenanceStatus, string> = {
  submitted: "Sent to your landlord",
  acknowledged: "Seen by your landlord",
  in_progress: "Being fixed",
  on_hold: "On hold",
  resolved: "Fixed",
  closed: "Closed",
  cancelled: "Cancelled",
};

export function PortalRepairs() {
  const { tenantId } = useTenancy();
  const params = useSearchParams();
  const router = useRouter();
  const list = usePortalMaintenanceList(tenantId);
  const reporting = params.get("new") === "1";
  const setReporting = (open: boolean) => router.replace(open ? "/portal/maintenance?new=1" : "/portal/maintenance", { scroll: false });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Repairs</h1>
        {!reporting && <Button onClick={() => setReporting(true)}><Plus /> Report a repair</Button>}
      </div>
      {reporting && <ReportForm onDone={(id) => (id ? router.push(`/portal/maintenance/${id}`) : setReporting(false))} />}
      {list.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : list.isError ? (
        <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
      ) : list.data.length === 0 ? (
        !reporting && <EmptyState icon={Wrench} title="No repairs reported" description="Something broken or leaking? Report it here and follow the fix." />
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {list.data.map((r) => (
            <li key={r.id}>
              <Link href={`/portal/maintenance/${r.id}`} className="flex items-center gap-3 p-4 hover:bg-muted/50">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{r.title}</span>
                  <span className="block text-xs text-muted-foreground">{r.reference} · {formatDay(r.created_at.slice(0, 10))}</span>
                </span>
                <Badge variant={MAINTENANCE_STATUS[r.status].variant}>{TENANT_STATUS[r.status]}</Badge>
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReportForm({ onDone }: { onDone: (id?: string) => void }) {
  const { tenantId } = useTenancy();
  const summary = usePortalSummary(tenantId);
  const report = useReportIssue(tenantId);
  const photos = useAddRepairPhotos(tenantId);
  const active = summary.data?.leases.filter((l) => l.status === "active") ?? [];
  const [form, setForm] = React.useState({ lease: "", category: "plumbing" as MaintenanceCategory, urgency: "normal" as Urgency, title: "", description: "" });
  const [files, setFiles] = React.useState<File[]>([]);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const lease = form.lease || active[0]?.id || "";

  if (summary.data && active.length === 0) {
    return <Alert title="No active lease">You can report repairs for the home you currently rent.</Alert>;
  }
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">Report a repair</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {report.isError && <Alert variant="error" title={report.error.message} />}
        {active.length > 1 && (
          <FormField id="r-lease" label="Home">
            <NativeSelect value={lease} onChange={(e) => set("lease", e.target.value)}>
              {active.map((l) => <option key={l.id} value={l.id}>{l.property_name} unit {l.unit_number}</option>)}
            </NativeSelect>
          </FormField>
        )}
        <div className="grid grid-cols-2 gap-3">
          <FormField id="r-cat" label="What kind?">
            <NativeSelect value={form.category} onChange={(e) => set("category", e.target.value as MaintenanceCategory)}>
              {Object.entries(MAINTENANCE_CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </NativeSelect>
          </FormField>
          <FormField id="r-urg" label="How urgent?">
            <NativeSelect value={form.urgency} onChange={(e) => set("urgency", e.target.value as Urgency)}>
              {Object.entries(URGENCY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </NativeSelect>
          </FormField>
        </div>
        {form.urgency === "emergency" && (
          <Alert variant="error" title="For danger to people or property">
            Gas leaks, fire, flooding or no security: also call your landlord now.
          </Alert>
        )}
        <FormField id="r-title" label="What's wrong?">
          <Input maxLength={160} placeholder="e.g. Kitchen sink leaking" value={form.title} onChange={(e) => set("title", e.target.value)} />
        </FormField>
        <FormField id="r-desc" label="Details" hint="Where exactly, since when, and when someone can get in.">
          <Textarea rows={4} value={form.description} onChange={(e) => set("description", e.target.value)} />
        </FormField>
        <PhotoPicker files={files} onChange={setFiles} />
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => onDone()}>Cancel</Button>
          <Button className="flex-1"
            disabled={!lease || !form.title.trim() || !form.description.trim()}
            loading={report.isPending || photos.isPending}
            onClick={() => report.mutate({ ...form, lease }, {
              onSuccess: async (r) => {
                if (files.length) {
                  try {
                    await photos.mutateAsync({ id: r.id, files });
                  } catch (e) {
                    toast.error(`Repair reported, but a photo couldn't be added: ${errorMessage(e)}`);
                  }
                }
                toast.success(`${r.reference} sent to your landlord`);
                onDone(r.id);
              },
            })}>
            <Send /> Send report
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PhotoPicker({ files, onChange }: { files: File[]; onChange: (files: File[]) => void }) {
  const input = React.useRef<HTMLInputElement>(null);
  const previews = React.useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  React.useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Photos (optional)</p>
      <div className="flex flex-wrap gap-2">
        {previews.map((src, n) => (
          <div key={src} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
            <img src={src} alt={`Photo ${n + 1}`} className="size-20 rounded-lg border object-cover" />
            <button type="button" className="absolute -right-1.5 -top-1.5 rounded-full bg-foreground p-0.5 text-background"
              onClick={() => onChange(files.filter((_, i) => i !== n))}>
              <X className="size-3.5" /><span className="sr-only">Remove photo {n + 1}</span>
            </button>
          </div>
        ))}
        {files.length < 5 && (
          <button type="button" onClick={() => input.current?.click()}
            className="flex size-20 flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-xs text-muted-foreground hover:bg-muted">
            <Camera className="size-5" /> Add
          </button>
        )}
      </div>
      <input ref={input} type="file" accept="image/*" multiple hidden aria-label="Add photos"
        onChange={(e) => { onChange([...files, ...Array.from(e.target.files ?? [])].slice(0, 5)); e.target.value = ""; }} />
    </div>
  );
}

export function PortalRepairDetail() {
  const { id } = useParams<{ id: string }>();
  const { tenantId, timeZone } = useTenancy();
  const req = usePortalMaintenance(tenantId, id);
  const act = useMaintenanceMessage(tenantId, id);
  const [message, setMessage] = React.useState("");
  const [cancelling, setCancelling] = React.useState(false);
  const photoInput = React.useRef<HTMLInputElement>(null);

  if (req.isPending) return <Skeleton className="h-96 w-full" />;
  if (req.isError) {
    return <ErrorState message={req.error instanceof ApiError && req.error.status === 404 ? "This repair doesn't exist or isn't yours." : errorMessage(req.error)} />;
  }
  const r = req.data;
  const open = r.status !== "closed" && r.status !== "cancelled";

  return (
    <>
      <Link href="/portal/maintenance" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Repairs
      </Link>
      <div className="mb-4 space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">{r.title}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge variant={MAINTENANCE_STATUS[r.status].variant}>{TENANT_STATUS[r.status]}</Badge>
          {r.reference} · {MAINTENANCE_CATEGORY[r.category]} · {r.property_name} unit {r.unit_number}
        </div>
        {r.scheduled_for && open && <p className="text-sm font-medium">Visit planned for {formatDay(r.scheduled_for)}</p>}
      </div>

      <div className="space-y-4">
        <Card>
          <CardContent className="space-y-3 pt-6 text-sm">
            <p className="whitespace-pre-line">{r.description}</p>
            {(r.photos ?? []).length > 0 && (
              <div className="flex flex-wrap gap-2">
                {r.photos!.map((p) => <Photo key={p.id} requestId={r.id} photoId={p.id} title={p.title} />)}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Updates</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <ol className="space-y-3">
              <li className="text-sm">
                <p className="text-xs text-muted-foreground">{formatDateTime(r.created_at, timeZone)}</p>
                <p>You reported this repair.</p>
              </li>
              {(r.updates ?? []).map((u) => (
                <li key={u.id} className={`rounded-lg p-3 text-sm ${u.from_tenant ? "ml-6 bg-primary/5" : "mr-6 bg-muted/60"}`}>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{u.from_tenant ? "You" : u.author_name}</span> · {formatDateTime(u.created_at, timeZone)}
                  </p>
                  {u.status_to && <p className="font-medium">{TENANT_STATUS[u.status_to as MaintenanceStatus] ?? u.status_to}</p>}
                  {u.body && <p className="whitespace-pre-line">{u.body}</p>}
                </li>
              ))}
            </ol>
            {open && (
              <div className="space-y-2 border-t pt-3">
                {act.isError && <Alert variant="error" title={act.error.message} />}
                <Textarea rows={2} aria-label="Message your landlord" placeholder="Add a message for your landlord…" value={message} onChange={(e) => setMessage(e.target.value)} />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={!message.trim()} loading={act.isPending && act.variables?.action === "message"}
                    onClick={() => act.mutate({ action: "message", body: message }, { onSuccess: () => { setMessage(""); toast.success("Message sent"); } })}>
                    <Send /> Send
                  </Button>
                  <Button size="sm" variant="outline" loading={act.isPending && act.variables?.action === "photo"} onClick={() => photoInput.current?.click()}>
                    <ImagePlus /> Add photo
                  </Button>
                  {r.status === "submitted" && (
                    <Button size="sm" variant="ghost" onClick={() => setCancelling(true)}>Cancel request</Button>
                  )}
                </div>
                <input ref={photoInput} type="file" accept="image/*" hidden aria-label="Add a photo"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) act.mutate({ action: "photo", file }, { onSuccess: () => toast.success("Photo added") });
                  }} />
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title="Cancel this repair request?"
        description="Only do this if it's no longer needed. You can report it again later."
        confirmLabel="Cancel request"
        destructive
        loading={act.isPending}
        onConfirm={() => act.mutate({ action: "cancel" }, {
          onSuccess: () => { setCancelling(false); toast.success("Request cancelled"); },
          onError: (e) => { setCancelling(false); toast.error(errorMessage(e)); },
        })}
      />
    </>
  );
}

function Photo({ requestId, photoId, title }: { requestId: string; photoId: string; title: string }) {
  const { tenantId } = useTenancy();
  const blob = usePortalPhoto(tenantId, requestId, photoId);
  const url = React.useMemo(() => (blob.data ? URL.createObjectURL(blob.data) : null), [blob.data]);
  React.useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  if (!url) return <Skeleton className="size-24 rounded-lg" />;
  return (
    <a href={url} target="_blank" rel="noreferrer">
      {/* eslint-disable-next-line @next/next/no-img-element -- private blob, not optimisable */}
      <img src={url} alt={title} className="size-24 rounded-lg border object-cover" />
    </a>
  );
}
