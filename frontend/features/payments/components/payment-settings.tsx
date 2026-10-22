"use client";

import { CheckCircle2, Copy, CreditCard, Pencil, Plug, Plus, ShieldCheck } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/page-header";
import { useOrganization } from "@/components/providers/organization-provider";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import { usePropertyOptions } from "@/features/properties/api";
import {
  useConfigurationAction,
  usePaymentConfigurations,
  useProviderEvents,
  useSaveConfiguration,
} from "@/features/payments/api";
import { ApiError, errorMessage } from "@/lib/api/errors";
import { INTEGRATION_STATUS, PAYMENT_PROVIDER } from "@/lib/labels";
import { formatDateTime } from "@/lib/utils";
import type { PaymentConfiguration, PaymentProvider } from "@/types/api";

export function PaymentSettingsPage() {
  const { can } = useOrganization();
  const configs = usePaymentConfigurations(can("payments.view"));
  const [editing, setEditing] = React.useState<PaymentConfiguration | "new" | null>(null);
  const [connecting, setConnecting] = React.useState<PaymentConfiguration | null>(null);
  const canManage = can("payment_settings.manage");

  if (!can("payments.view")) return <Alert variant="error" title="You don't have permission to view payment settings." />;

  return (
    <>
      <PageHeader
        title="Payment settings"
        description="How your tenants pay you. These are your own accounts: Nexora never holds tenants' money."
        actions={
          canManage && (
            <Button onClick={() => setEditing("new")}>
              <Plus /> Add payment method
            </Button>
          )
        }
      />
      {configs.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : configs.isError ? (
        <ErrorState message={errorMessage(configs.error)} onRetry={() => configs.refetch()} />
      ) : configs.data.length === 0 ? (
        <EmptyState
          icon={CreditCard}
          title="No payment methods yet"
          description="Add your M-Pesa paybill or till, bank account, or cash so tenants know how to pay and payments can be recorded."
          action={canManage && <Button onClick={() => setEditing("new")}><Plus /> Add payment method</Button>}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {configs.data.map((c) => {
            const isMpesa = c.provider === "mpesa_paybill" || c.provider === "mpesa_till";
            const status = INTEGRATION_STATUS[c.integration_status];
            return (
              <Card key={c.id} className={c.is_enabled ? "" : "opacity-70"}>
                <CardHeader className="flex-row items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">{c.display_name}</CardTitle>
                    <CardDescription>
                      {PAYMENT_PROVIDER[c.provider]} · {c.property_name ?? "All properties"}
                    </CardDescription>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {!c.is_enabled && <Badge variant="muted">Disabled</Badge>}
                    {isMpesa && <Badge variant={status.variant}>{status.label}</Badge>}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {c.shortcode && (
                    <p>
                      {c.provider === "mpesa_till" ? "Till" : "Paybill"} <strong className="font-mono">{c.shortcode}</strong>
                      {c.account_reference_hint && <span className="text-muted-foreground"> · Account: {c.account_reference_hint}</span>}
                    </p>
                  )}
                  {c.provider === "bank" && (
                    <p>
                      {c.bank_name}
                      {c.bank_branch && `, ${c.bank_branch}`} · <span className="font-mono">{c.account_number}</span>
                      {c.account_name && <span className="block text-muted-foreground">{c.account_name}</span>}
                    </p>
                  )}
                  {c.instructions && <p className="whitespace-pre-line text-muted-foreground">{c.instructions}</p>}
                  {canManage && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button size="sm" variant="outline" onClick={() => setEditing(c)}>
                        <Pencil /> Edit
                      </Button>
                      {isMpesa && (
                        <Button size="sm" variant="outline" onClick={() => setConnecting(c)}>
                          <Plug /> M-Pesa connection
                        </Button>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-4" /> About automatic payment detection
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            <strong className="text-foreground">M-Pesa:</strong> connect your paybill or till with Safaricom Daraja API
            credentials to receive payments automatically and send payment prompts to tenants. This needs
            Daraja approval for your shortcode and, in production, Safaricom&apos;s go-live process.
          </p>
          <p>
            <strong className="text-foreground">Banks:</strong> a bank account number alone doesn&apos;t tell Nexora when
            money arrives. Import statement CSVs under Payments → Bank imports; direct bank API connections
            depend on your bank offering one.
          </p>
        </CardContent>
      </Card>
      <ConfigurationDialog config={editing} onClose={() => setEditing(null)} />
      <ConnectionDialog config={connecting && (configs.data?.find((c) => c.id === connecting.id) ?? connecting)} onClose={() => setConnecting(null)} />
    </>
  );
}

type FormState = Omit<
  PaymentConfiguration,
  | "id" | "method" | "property_name" | "integration_status" | "integration_message" | "integration_checked_at"
  | "c2b_registered_at" | "has_credentials" | "has_passkey" | "callback_urls" | "created_at" | "updated_at" | "property"
> & { property: string };

function toState(c?: PaymentConfiguration): FormState {
  return {
    provider: c?.provider ?? "mpesa_paybill",
    display_name: c?.display_name ?? "",
    property: c?.property ?? "",
    shortcode: c?.shortcode ?? "",
    account_reference_hint: c?.account_reference_hint ?? "Your unit number or lease number",
    bank_name: c?.bank_name ?? "",
    bank_branch: c?.bank_branch ?? "",
    account_name: c?.account_name ?? "",
    account_number: c?.account_number ?? "",
    instructions: c?.instructions ?? "",
    currency: c?.currency ?? "KES",
    is_enabled: c?.is_enabled ?? true,
    valid_from: c?.valid_from ?? null,
    valid_to: c?.valid_to ?? null,
    environment: c?.environment ?? "sandbox",
  };
}

function ConfigurationDialog({ config, onClose }: { config: PaymentConfiguration | "new" | null; onClose: () => void }) {
  return (
    <Dialog open={config !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        {config !== null && <ConfigurationForm config={config === "new" ? undefined : config} onDone={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function ConfigurationForm({ config, onDone }: { config?: PaymentConfiguration; onDone: () => void }) {
  const properties = usePropertyOptions();
  const save = useSaveConfiguration();
  const [s, setS] = React.useState<FormState>(toState(config));
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setS((prev) => ({ ...prev, [k]: v }));
  const isMpesa = s.provider === "mpesa_paybill" || s.provider === "mpesa_till";
  const err = (f: string) => (save.error instanceof ApiError ? save.error.fieldError(f) : undefined);

  return (
    <>
      <DialogHeader>
        <DialogTitle>{config ? "Edit payment method" : "Add a payment method"}</DialogTitle>
        <DialogDescription>
          Shown to tenants as payment instructions. Past payments keep the details that applied when they were made.
        </DialogDescription>
      </DialogHeader>
      {save.isError && !Object.keys((save.error as ApiError).details ?? {}).length && <Alert variant="error" title={save.error.message} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="pc-provider" label="Type">
          <NativeSelect value={s.provider} disabled={Boolean(config)} onChange={(e) => set("provider", e.target.value as PaymentProvider)}>
            {Object.entries(PAYMENT_PROVIDER).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField id="pc-name" label="Name" error={err("display_name")} hint="e.g. “Rent paybill”">
          <Input value={s.display_name} onChange={(e) => set("display_name", e.target.value)} />
        </FormField>
        <FormField id="pc-property" label="Applies to" hint="A property's own methods replace the organization-wide ones for its tenants.">
          <NativeSelect value={s.property} onChange={(e) => set("property", e.target.value)}>
            <option value="">All properties</option>
            {properties.data?.results.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        {isMpesa && (
          <>
            <FormField id="pc-shortcode" label={s.provider === "mpesa_till" ? "Till number" : "Paybill number"} error={err("shortcode")}>
              <Input inputMode="numeric" value={s.shortcode} onChange={(e) => set("shortcode", e.target.value.trim())} />
            </FormField>
            <div className="sm:col-span-2">
              <FormField id="pc-hint" label="Account number tenants should enter">
                <Input value={s.account_reference_hint} onChange={(e) => set("account_reference_hint", e.target.value)} />
              </FormField>
            </div>
          </>
        )}
        {s.provider === "bank" && (
          <>
            <FormField id="pc-bank" label="Bank" error={err("bank_name")}>
              <Input value={s.bank_name} onChange={(e) => set("bank_name", e.target.value)} />
            </FormField>
            <FormField id="pc-branch" label="Branch">
              <Input value={s.bank_branch} onChange={(e) => set("bank_branch", e.target.value)} />
            </FormField>
            <FormField id="pc-holder" label="Account name">
              <Input value={s.account_name} onChange={(e) => set("account_name", e.target.value)} />
            </FormField>
            <FormField id="pc-number" label="Account number" error={err("account_number")}>
              <Input value={s.account_number} onChange={(e) => set("account_number", e.target.value)} />
            </FormField>
          </>
        )}
      </div>
      <FormField id="pc-instructions" label="Instructions for tenants (optional)">
        <Textarea rows={2} value={s.instructions} onChange={(e) => set("instructions", e.target.value)} />
      </FormField>
      <label className="flex items-center gap-3 text-sm">
        <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={s.is_enabled} onChange={(e) => set("is_enabled", e.target.checked)} />
        Enabled (shown to tenants and available when recording payments)
      </label>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button
          disabled={!s.display_name.trim()}
          loading={save.isPending}
          onClick={() =>
            save.mutate(
              { id: config?.id, ...s, property: s.property || null },
              {
                onSuccess: () => {
                  toast.success(config ? "Payment method updated" : "Payment method added");
                  onDone();
                },
              },
            )
          }
        >
          Save
        </Button>
      </DialogFooter>
    </>
  );
}

function ConnectionDialog({ config, onClose }: { config: PaymentConfiguration | null; onClose: () => void }) {
  const { current } = useOrganization();
  const action = useConfigurationAction();
  const events = useProviderEvents(config?.id ?? "", config !== null && config.integration_status === "verified");
  const [creds, setCreds] = React.useState({ consumer_key: "", consumer_secret: "", passkey: "", environment: "" });
  if (!config) return null;
  const status = INTEGRATION_STATUS[config.integration_status];
  const run = (kind: "credentials" | "test" | "register-c2b", body?: object, done?: string) =>
    action.mutate(
      { id: config.id, action: kind, body },
      {
        onSuccess: (c) => {
          if (kind === "credentials") setCreds({ consumer_key: "", consumer_secret: "", passkey: "", environment: "" });
          if (kind === "test") {
            if (c.integration_status === "verified") toast.success("Connected to M-Pesa");
            else toast.error(c.integration_message || "Connection failed");
          } else if (done) toast.success(done);
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  const copy = (text: string) => navigator.clipboard?.writeText(text).then(() => toast.success("Copied"));

  return (
    <Dialog open onOpenChange={(o) => { if (!o) { action.reset(); onClose(); } }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            M-Pesa connection <Badge variant={status.variant}>{status.label}</Badge>
          </DialogTitle>
          <DialogDescription>
            {config.display_name} ({config.shortcode}). Credentials come from your app on developer.safaricom.co.ke. They are
            encrypted and never shown again after saving.
          </DialogDescription>
        </DialogHeader>
        {config.integration_message && (
          <Alert variant={config.integration_status === "failed" ? "error" : config.integration_status === "verified" ? "success" : "info"} title={config.integration_message}>
            {config.integration_checked_at && `Checked ${formatDateTime(config.integration_checked_at, current.organization.timezone)}`}
          </Alert>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="mp-env" label="Environment">
            <NativeSelect value={creds.environment || config.environment} onChange={(e) => setCreds({ ...creds, environment: e.target.value })}>
              <option value="sandbox">Sandbox (testing)</option>
              <option value="production">Production (live money)</option>
            </NativeSelect>
          </FormField>
          <div />
          <FormField id="mp-key" label="Consumer key" hint={config.has_credentials ? "Saved. Leave blank to keep it." : undefined}>
            <Input autoComplete="off" value={creds.consumer_key} onChange={(e) => setCreds({ ...creds, consumer_key: e.target.value })} />
          </FormField>
          <FormField id="mp-secret" label="Consumer secret" hint={config.has_credentials ? "Saved. Leave blank to keep it." : undefined}>
            <Input type="password" autoComplete="off" value={creds.consumer_secret} onChange={(e) => setCreds({ ...creds, consumer_secret: e.target.value })} />
          </FormField>
          <div className="sm:col-span-2">
            <FormField id="mp-passkey" label="Lipa na M-Pesa passkey (for payment prompts)" hint={config.has_passkey ? "Saved. Leave blank to keep it." : "Optional; needed to send STK payment prompts."}>
              <Input type="password" autoComplete="off" value={creds.passkey} onChange={(e) => setCreds({ ...creds, passkey: e.target.value })} />
            </FormField>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            loading={action.isPending && action.variables?.action === "credentials"}
            disabled={!config.has_credentials && !(creds.consumer_key && creds.consumer_secret)}
            onClick={() => run("credentials", Object.fromEntries(Object.entries(creds).filter(([, v]) => v)), "Credentials saved")}
          >
            Save credentials
          </Button>
          <Button variant="outline" disabled={!config.has_credentials} loading={action.isPending && action.variables?.action === "test"} onClick={() => run("test")}>
            Test connection
          </Button>
          <Button
            variant="outline"
            disabled={config.integration_status !== "verified"}
            loading={action.isPending && action.variables?.action === "register-c2b"}
            onClick={() => run("register-c2b", undefined, "Callback URLs registered with Safaricom")}
          >
            Register callback URLs
          </Button>
        </div>
        {config.c2b_registered_at && (
          <p className="flex items-center gap-2 text-sm text-accent-strong">
            <CheckCircle2 className="size-4" /> Callback URLs registered {formatDateTime(config.c2b_registered_at, current.organization.timezone)}
          </p>
        )}
        {config.callback_urls ? (
          <div className="space-y-2 rounded-lg bg-muted p-3 text-xs">
            <p className="font-medium">Your callback URLs (keep these private; they identify your account)</p>
            {Object.entries(config.callback_urls).map(([k, url]) => (
              <div key={k} className="flex items-center gap-2">
                <span className="w-24 shrink-0 text-muted-foreground">{k.replace("_", " ")}</span>
                <code className="min-w-0 flex-1 truncate">{url}</code>
                <Button variant="ghost" size="icon" aria-label={`Copy ${k} URL`} onClick={() => copy(url)}>
                  <Copy />
                </Button>
              </div>
            ))}
          </div>
        ) : config.has_credentials ? (
          <Alert title="Callback URLs need a public address">
            Safaricom can only reach this API at a public https URL. Set NEXORA_PUBLIC_API_URL on the server (an ngrok
            tunnel works for sandbox testing).
          </Alert>
        ) : null}
        {events.data && events.data.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium">Recent notifications from Safaricom</p>
            <ul className="max-h-40 divide-y overflow-y-auto rounded-lg border text-xs">
              {events.data.map((e) => (
                <li key={e.id} className="flex justify-between gap-3 px-3 py-2">
                  <span>
                    {e.event_type.replace("_", " ")} · {e.external_id || "—"}
                    <span className="block text-muted-foreground">{e.message}</span>
                  </span>
                  <Badge variant={e.status === "processed" ? "accent" : e.status === "duplicate" ? "muted" : "destructive"}>{e.status}</Badge>
                </li>
              ))}
            </ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
