"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { useOrganization } from "@/components/providers/organization-provider";
import { Alert } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { InvitationsTable } from "./invitations-table";
import { InviteDialog } from "./invite-dialog";
import { MembersTable } from "./members-table";

export function TeamPage() {
  const { can } = useOrganization();
  const router = useRouter();
  const pathname = usePathname();
  const tab = useSearchParams().get("tab") === "invitations" ? "invitations" : "members";

  if (!can("members.view")) {
    return <Alert variant="error" title="You don't have permission to view the team." />;
  }

  return (
    <>
      <PageHeader
        title="Team"
        description="Manage who can access this organization and what they can do."
        actions={can("members.manage") ? <InviteDialog /> : undefined}
      />
      <Tabs
        value={tab}
        onValueChange={(v) => router.replace(v === "members" ? pathname : `${pathname}?tab=${v}`)}
      >
        <TabsList className="mb-4">
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="invitations">Invitations</TabsTrigger>
        </TabsList>
        <TabsContent value="members">
          <MembersTable />
        </TabsContent>
        <TabsContent value="invitations">
          <InvitationsTable />
        </TabsContent>
      </Tabs>
    </>
  );
}
