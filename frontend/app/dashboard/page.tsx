import type { Metadata } from "next";

import { DashboardOverview } from "@/features/dashboard/overview";

export const metadata: Metadata = { title: "Overview" };
// Rendered client-side after the session check; nothing to validate as an instant navigation.
export const instant = false;


export default function Page() {
  return <DashboardOverview />;
}
