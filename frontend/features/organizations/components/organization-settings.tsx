"use client";

import { toast } from "sonner";

import { PageHeader } from "@/components/layout/page-header";
import { useOrganization } from "@/components/providers/organization-provider";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useUpdateOrganization } from "@/features/organizations/api";
import { OrganizationForm } from "@/features/organizations/components/organization-form";

export function OrganizationSettingsPage() {
  const { current, can } = useOrganization();
  const update = useUpdateOrganization();
  const org = current.organization;
  const editable = can("organization.manage");

  return (
    <>
      <PageHeader title="Organization settings" description="Details used across Nexora." />
      {!editable && (
        <Alert className="mb-4" title="Only people with “Manage organization settings” can edit these." />
      )}
      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            Currency and timezone become defaults for properties, billing and reports.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OrganizationForm
            key={org.id}
            initialValues={{
              name: org.name,
              legal_name: org.legal_name,
              email: org.email,
              phone: org.phone,
              address: org.address,
              country: org.country,
              currency: org.currency,
              timezone: org.timezone,
            }}
            submitLabel="Save changes"
            pending={update.isPending}
            error={update.error}
            disabled={!editable}
            onSubmit={(values) =>
              update.mutate(values, { onSuccess: () => toast.success("Organization updated") })
            }
          />
        </CardContent>
      </Card>
    </>
  );
}
