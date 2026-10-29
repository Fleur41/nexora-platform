"use client";

import { Megaphone, Send } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/page-header";
import { useOrganization } from "@/components/providers/organization-provider";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormField } from "@/components/ui/form-field";
import { Input, NativeSelect } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  useAnnouncements,
  useDeliveryLog,
  useNotificationSettings,
  useSaveNotificationSettings,
  useSendAnnouncement,
} from "@/features/notifications/api";
import { usePropertyOptions } from "@/features/properties/api";
import { errorMessage } from "@/lib/api/errors";
import { formatDateTime, plural } from "@/lib/utils";
import type { DeliveryLogEntry, NotificationSettings } from "@/types/api";

const DELIVERY_STATUS: Record<DeliveryLogEntry["status"], { label: string; variant: "muted" | "default" | "accent" | "destructive" }> = {
  pending: { label: "Pending", variant: "default" },
  sent: { label: "Sent", variant: "accent" },
  failed: { label: "Failed", variant: "destructive" },
  skipped: { label: "Skipped", variant: "muted" },
};

export function CommunicationsPage() {
  const { can } = useOrganization();
  const tabs = [
    can("announcements.send") && { value: "announcements", label: "Announcements" },
    can("notifications.configure") && { value: "log", label: "Delivery log" },
    can("notifications.configure") && { value: "settings", label: "Reminders & channels" },
  ].filter(Boolean) as { value: string; label: string }[];

  if (tabs.length === 0) return <Alert variant="error" title="You don't have permission to manage communications." />;

  return (
    <>
      <PageHeader title="Communications" description="Announcements to tenants, automatic reminders and the record of every email and SMS sent." />
      <Tabs defaultValue={tabs[0]!.value}>
        <TabsList className="mb-4">
          {tabs.map((t) => <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>)}
        </TabsList>
        <TabsContent value="announcements"><Announcements /></TabsContent>
        <TabsContent value="log"><DeliveryLog /></TabsContent>
        <TabsContent value="settings"><SettingsForm /></TabsContent>
      </Tabs>
    </>
  );
}

function Announcements() {
  const { current } = useOrganization();
  const [page, setPage] = React.useState(1);
  const list = useAnnouncements(page);
  const properties = usePropertyOptions();
  const send = useSendAnnouncement();
  const blank = { title: "", body: "", property: "", send_email: true, send_sms: false };
  const [form, setForm] = React.useState(blank);
  const [confirming, setConfirming] = React.useState(false);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const audience = form.property ? `tenants of ${properties.data?.results.find((p) => p.id === form.property)?.name ?? "this property"}` : "all current tenants";

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <Card className="h-fit lg:col-span-2">
        <CardHeader>
          <CardTitle>New announcement</CardTitle>
          <CardDescription>Goes to the portal inbox of every tenant with an active lease, plus email or SMS if chosen.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {send.isError && <Alert variant="error" title={send.error.message} />}
          <FormField id="a-prop" label="Send to">
            <NativeSelect value={form.property} onChange={(e) => set("property", e.target.value)}>
              <option value="">All properties</option>
              {properties.data?.results.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </NativeSelect>
          </FormField>
          <FormField id="a-title" label="Title">
            <Input maxLength={160} value={form.title} onChange={(e) => set("title", e.target.value)} />
          </FormField>
          <FormField id="a-body" label="Message" hint={form.send_sms ? `SMS: ${form.body.length} characters (${Math.max(1, Math.ceil(form.body.length / 160))} per tenant)` : undefined}>
            <Textarea rows={5} value={form.body} onChange={(e) => set("body", e.target.value)} />
          </FormField>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={form.send_email} onChange={(e) => set("send_email", e.target.checked)} /> Email
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={form.send_sms} onChange={(e) => set("send_sms", e.target.checked)} /> SMS
            </label>
          </div>
          <Button disabled={!form.title.trim() || !form.body.trim()} onClick={() => setConfirming(true)}><Send /> Send</Button>
        </CardContent>
      </Card>
      <div className="lg:col-span-3">
        {list.isPending ? (
          <Skeleton className="h-72 w-full" />
        ) : list.isError ? (
          <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
        ) : list.data.results.length === 0 ? (
          <EmptyState icon={Megaphone} title="No announcements yet" description="Water interruptions, meetings, rule changes — tell every tenant at once." />
        ) : (
          <ul className="space-y-3">
            {list.data.results.map((a) => (
              <li key={a.id} className="rounded-xl border bg-card p-4">
                <p className="font-medium">{a.title}</p>
                <p className="mt-1 whitespace-pre-line text-sm">{a.body}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {a.property_name ?? "All properties"} · {plural(a.recipients, "tenant")} · {[a.send_email && "email", a.send_sms && "SMS"].filter(Boolean).join(" + ") || "portal only"} · {a.sent_by_name} · {formatDateTime(a.created_at, current.organization.timezone)}
                </p>
              </li>
            ))}
          </ul>
        )}
        {list.data && <Pagination page={page} pageSize={25} count={list.data.count} onPageChange={setPage} />}
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Send announcement?"
        description={<>“{form.title}” goes to {audience}{form.send_sms && ". SMS messages are charged by your provider"}. It can&apos;t be recalled.</>}
        confirmLabel="Send now"
        loading={send.isPending}
        onConfirm={() => send.mutate({ ...form, property: form.property || null }, {
          onSuccess: (a) => { setConfirming(false); setForm(blank); toast.success(`Sent to ${plural(a.recipients, "tenant")}`); },
          onError: () => setConfirming(false),
        })}
      />
    </div>
  );
}

function DeliveryLog() {
  const { current } = useOrganization();
  const [status, setStatus] = React.useState("");
  const [page, setPage] = React.useState(1);
  const log = useDeliveryLog({ status, page });
  return (
    <>
      <NativeSelect aria-label="Delivery status" className="mb-4 md:w-44" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
        <option value="">Any status</option>
        {Object.entries(DELIVERY_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
      </NativeSelect>
      {log.isPending ? (
        <Skeleton className="h-72 w-full" />
      ) : log.isError ? (
        <ErrorState message={errorMessage(log.error)} onRetry={() => log.refetch()} />
      ) : log.data.results.length === 0 ? (
        <EmptyState icon={Send} title="Nothing sent yet" description="Invoices, receipts, reminders and announcements sent by email or SMS are listed here." />
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Message</TableHead>
                <TableHead className="hidden md:table-cell">To</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden lg:table-cell">When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {log.data.results.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>
                    {d.title}
                    <p className="text-xs text-muted-foreground">{d.channel === "sms" ? "SMS" : "Email"} · {d.kind.replaceAll("_", " ")}</p>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {d.tenant_name ?? d.user_name ?? "—"}
                    <p className="text-xs text-muted-foreground">{d.to_address}</p>
                  </TableCell>
                  <TableCell>
                    <Badge variant={DELIVERY_STATUS[d.status].variant}>{DELIVERY_STATUS[d.status].label}</Badge>
                    {d.error && <p className="mt-1 max-w-xs text-xs text-destructive">{d.error}</p>}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">{formatDateTime(d.sent_at ?? d.created_at, current.organization.timezone)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {log.data && <Pagination page={page} pageSize={25} count={log.data.count} onPageChange={setPage} />}
    </>
  );
}

function SettingsForm() {
  const settings = useNotificationSettings();
  if (settings.isPending) return <Skeleton className="h-72 w-full" />;
  if (settings.isError) return <ErrorState message={errorMessage(settings.error)} onRetry={() => settings.refetch()} />;
  return <SettingsFields initial={settings.data} />;
}

function SettingsFields({ initial }: { initial: NotificationSettings }) {
  const save = useSaveNotificationSettings();
  const [form, setForm] = React.useState(initial);
  const set = <K extends keyof NotificationSettings>(k: K, v: NotificationSettings[K]) => setForm((f) => ({ ...f, [k]: v }));
  const toggle = (k: keyof NotificationSettings, label: string, hint?: string) => (
    <label className="flex items-start gap-3 text-sm">
      <input type="checkbox" className="mt-0.5 size-4 accent-[var(--accent)]" checked={form[k] as boolean} onChange={(e) => set(k, e.target.checked)} />
      <span>{label}{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</span>
    </label>
  );
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Reminders &amp; channels</CardTitle>
        <CardDescription>Tenants always see notifications in their portal. These settings control email, SMS and automatic reminders.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {save.isError && <Alert variant="error" title={save.error.message} />}
        <div className="space-y-3">
          {toggle("email_enabled", "Send email", "To tenants who have an email address.")}
          {toggle("sms_enabled", "Send SMS", "Uses the SMS provider configured for this deployment.")}
          {toggle("invoice_notifications", "Notify tenants when an invoice is issued")}
          {toggle("receipt_notifications", "Send a receipt when a payment is recorded")}
          {toggle("arrears_reminders", "Remind tenants with overdue balances")}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="ns-due" label="Rent due reminder" hint="Days before the due date; 0 turns it off.">
            <Input type="number" min={0} max={14} value={form.rent_due_reminder_days} onChange={(e) => set("rent_due_reminder_days", Number(e.target.value))} />
          </FormField>
          <FormField id="ns-expiry" label="Lease expiry alert" hint="Days before a lease ends (to staff and tenant).">
            <Input type="number" min={0} max={120} value={form.lease_expiry_days} onChange={(e) => set("lease_expiry_days", Number(e.target.value))} />
          </FormField>
        </div>
        <Button loading={save.isPending} onClick={() => save.mutate(form, { onSuccess: () => toast.success("Settings saved") })}>Save settings</Button>
      </CardContent>
    </Card>
  );
}
