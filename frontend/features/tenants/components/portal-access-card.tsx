"use client";

import { Smartphone } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { useTenantPortalInvite } from "@/features/portal/api";
import { errorMessage } from "@/lib/api/errors";
import type { Tenant } from "@/types/api";

const STATUS = {
  none: { label: "Not invited", variant: "muted" },
  invited: { label: "Invited", variant: "warning" },
  active: { label: "Using the app", variant: "accent" },
} as const;

/** Invite a tenant to the tenant app (portal), resend the invitation, or revoke access. */
export function PortalAccessCard({ tenant: t }: { tenant: Tenant }) {
  const invite = useTenantPortalInvite();
  const [email, setEmail] = React.useState(t.email);
  const [revoking, setRevoking] = React.useState(false);
  const status = STATUS[t.portal_status];
  const send = () =>
    invite.mutate({ tenantId: t.id, action: "portal-invite", email: email.trim() }, {
      onSuccess: () => toast.success(`Invitation sent to ${email.trim()}`),
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2"><Smartphone className="size-4 text-muted-foreground" /> Tenant app</span>
          <Badge variant={status.variant}>{status.label}</Badge>
        </CardTitle>
        <CardDescription>
          {t.portal_status === "active"
            ? "They can see bills and receipts, pay with M-Pesa, report repairs and give notice from their phone."
            : "Invite them to see bills and receipts, pay rent and report repairs from their phone."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {invite.isError && <Alert variant="error" title={invite.error.message} />}
        {t.portal_status !== "active" ? (
          <>
            <FormField id="portal-email" label="Email for the invitation">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </FormField>
            <Button size="sm" disabled={!/^\S+@\S+\.\S+$/.test(email.trim())} loading={invite.isPending} onClick={send}>
              {t.portal_status === "invited" ? "Resend invitation" : "Send invitation"}
            </Button>
            {t.portal_status === "invited" && <p className="text-xs text-muted-foreground">Resending cancels the earlier link.</p>}
          </>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setRevoking(true)}>Remove access</Button>
        )}
      </CardContent>
      <ConfirmDialog
        open={revoking}
        onOpenChange={setRevoking}
        title={`Remove ${t.full_name}'s app access?`}
        description="They can no longer see this account in the tenant app. Their account and history with you are unchanged, and you can invite them again."
        confirmLabel="Remove access"
        destructive
        loading={invite.isPending}
        onConfirm={() => invite.mutate({ tenantId: t.id, action: "portal-revoke" }, {
          onSuccess: () => { setRevoking(false); toast.success("Access removed"); },
          onError: (e) => { setRevoking(false); toast.error(errorMessage(e)); },
        })}
      />
    </Card>
  );
}
