import type { Metadata } from "next";

import { AuditLogPage } from "@/features/audit/audit-log-page";

export const metadata: Metadata = { title: "Audit log" };
// Rendered client-side after the session check; nothing to validate as an instant navigation.
export const instant = false;


export default function Page() {
  return <AuditLogPage />;
}
