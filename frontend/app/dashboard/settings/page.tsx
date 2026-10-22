import type { Metadata } from "next";

import { OrganizationSettingsPage } from "@/features/organizations/components/organization-settings";

export const metadata: Metadata = { title: "Organization settings" };
// Rendered client-side after the session check; nothing to validate as an instant navigation.
export const instant = false;


export default function Page() {
  return <OrganizationSettingsPage />;
}
