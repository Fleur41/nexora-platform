import type { Metadata } from "next";

import { DashboardShell } from "@/components/layout/dashboard-shell";

export const metadata: Metadata = { title: { default: "Dashboard", template: "%s · Nexora" } };

export default function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  return <DashboardShell>{children}</DashboardShell>;
}
