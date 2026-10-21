"use client";

import { MailCheck } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMe } from "@/features/auth/api";
import { useAcceptInvitation, useInvitationPreview } from "@/features/organizations/api";
import { setActiveOrganizationId } from "@/lib/api/organization-store";
import { formatDate } from "@/lib/utils";

export function AcceptInvitation() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const me = useMe();
  const preview = useInvitationPreview(token);
  const accept = useAcceptInvitation();
  const here = `/invitations/${token}`;

  if (preview.isPending || me.isPending) {
    return <Skeleton className="h-64 w-full" />;
  }
  if (preview.isError) {
    return (
      <Alert variant="error" title="Invitation not found">
        This invitation link is invalid. Ask the person who invited you to send a new one.
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
          <MailCheck className="size-5 text-accent-strong" aria-hidden />
        </div>
        <CardTitle className="text-2xl">Join {invite.organization_name}</CardTitle>
        <CardDescription>
          {invite.invited_by_name || "A team member"} invited <strong>{invite.email}</strong> to
          join as <strong>{invite.role_label}</strong>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!invite.is_usable ? (
          <Alert variant="error" title="This invitation is no longer valid">
            It may have expired, been revoked or already been used.
          </Alert>
        ) : !user ? (
          <>
            <p className="text-sm text-muted-foreground">
              Sign in or create an account with {invite.email} to accept. This invitation
              expires on {formatDate(invite.expires_at)}.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button asChild className="flex-1">
                <Link href={`/login?next=${encodeURIComponent(here)}`}>Sign in</Link>
              </Button>
              <Button asChild variant="outline" className="flex-1">
                <Link
                  href={`/register?next=${encodeURIComponent(here)}&email=${encodeURIComponent(invite.email)}`}
                >
                  Create account
                </Link>
              </Button>
            </div>
          </>
        ) : !emailMatches ? (
          <Alert variant="error" title="Signed in with a different email">
            You are signed in as {user.email}, but this invitation is for {invite.email}. Sign out
            and sign in with the invited address.
          </Alert>
        ) : (
          <>
            {accept.isError && <Alert variant="error" title={accept.error.message} />}
            <Button
              className="w-full"
              loading={accept.isPending}
              onClick={() =>
                accept.mutate(token, {
                  onSuccess: (membership) => {
                    setActiveOrganizationId(membership.organization.id);
                    router.replace("/dashboard");
                  },
                })
              }
            >
              Accept invitation
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
