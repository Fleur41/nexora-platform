"use client";

import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { AuthGate, FullPageSkeleton } from "@/components/layout/auth-gate";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useCreateOrganization, useMyOrganizations } from "@/features/organizations/api";
import { setActiveOrganizationId } from "@/lib/api/organization-store";

import { OrganizationForm } from "./organization-form";

export function Onboarding() {
  return <AuthGate>{() => <OnboardingContent />}</AuthGate>;
}

function OnboardingContent() {
  const router = useRouter();
  const creatingAnother = useSearchParams().get("new") === "1";
  const orgs = useMyOrganizations();
  const create = useCreateOrganization();
  const hasOrganizations = (orgs.data?.length ?? 0) > 0;

  React.useEffect(() => {
    if (hasOrganizations && !creatingAnother && !create.isPending && !create.isSuccess) {
      router.replace("/dashboard");
    }
  }, [hasOrganizations, creatingAnother, create.isPending, create.isSuccess, router]);

  if (orgs.isPending || (hasOrganizations && !creatingAnother)) return <FullPageSkeleton />;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">
          {creatingAnother ? "Create another organization" : "Set up your organization"}
        </CardTitle>
        <CardDescription>
          An organization holds your properties, team and finances. You&apos;ll be its owner and
          can invite staff afterwards.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <OrganizationForm
          compact
          submitLabel="Create organization"
          pending={create.isPending}
          error={create.error}
          onSubmit={(values) =>
            create.mutate(values, {
              onSuccess: (membership) => {
                setActiveOrganizationId(membership.organization.id);
                router.replace("/dashboard");
              },
            })
          }
        />
      </CardContent>
    </Card>
  );
}
