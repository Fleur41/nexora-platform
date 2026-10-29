"use client";

import { Home } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useLogout, useMe } from "@/features/auth/api";
import { useAcceptPortalInvite, usePortalInvitePreview } from "@/features/portal/api";
import { formatDate } from "@/lib/utils";

/** Landing page for the tenant portal invitation email (/portal/join/<token>). */
export function PortalJoin() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const me = useMe();
  const preview = usePortalInvitePreview(token);
  const accept = useAcceptPortalInvite();
  const logout = useLogout();
  const here = `/portal/join/${token}`;

  if (preview.isPending || me.isPending) return <Skeleton className="h-64 w-full" />;
  if (preview.isError) {
    return (
      <Alert variant="error" title="Invitation not found">
        This link is invalid. Ask your landlord to send a new invitation.
      </Alert>
    );
  }
  const invite = preview.data;
  const user = me.data;
  const emailMatches = user && user.email.toLowerCase() === invite.email.toLowerCase();

  return (
    <Card>
      <CardHeader>
        <div className="mb-2 flex size-11 items-center justify-center rounded-full bg-accent/15">
          <Home className="size-5 text-accent-strong" aria-hidden />
        </div>
        <CardTitle className="text-2xl">Your home with {invite.organization_name}</CardTitle>
        <CardDescription>
          Hello {invite.tenant_name}. {invite.organization_name} invited <strong>{invite.email}</strong> to the
          tenant app: see your bills and receipts, pay rent with M-Pesa and report repairs.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!invite.is_usable ? (
          <Alert variant="error" title="This invitation is no longer valid">
            It may have expired or already been used. Ask your landlord for a new one.
          </Alert>
        ) : !user ? (
          <>
            <p className="text-sm text-muted-foreground">
              Create an account with {invite.email} (or sign in if you already have one). The link expires on {formatDate(invite.expires_at)}.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button asChild className="flex-1">
                <Link href={`/register?next=${encodeURIComponent(here)}&email=${encodeURIComponent(invite.email)}`}>Create account</Link>
              </Button>
              <Button asChild variant="outline" className="flex-1">
                <Link href={`/login?next=${encodeURIComponent(here)}`}>Sign in</Link>
              </Button>
            </div>
          </>
        ) : !emailMatches ? (
          <Alert variant="error" title="Signed in with a different email">
            You are signed in as {user.email}, but this invitation is for {invite.email}.{" "}
            <button type="button" className="font-medium underline" onClick={() => logout.mutate(undefined, { onSuccess: () => router.replace(`/login?next=${encodeURIComponent(here)}`) })}>
              Sign out
            </button>{" "}
            and use the invited address.
          </Alert>
        ) : (
          <>
            {accept.isError && <Alert variant="error" title={accept.error.message} />}
            <Button className="w-full" size="lg" loading={accept.isPending}
              onClick={() => accept.mutate(token, {
                onSuccess: (r) => {
                  try {
                    localStorage.setItem("nexora.activeTenancyId", r.tenant);
                  } catch {
                    // Private mode: the portal falls back to the first tenancy.
                  }
                  router.replace("/portal");
                },
              })}>
              Open my home
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
