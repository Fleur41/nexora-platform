import type { Metadata } from "next";

import { AccountPage } from "@/features/account/account-page";

export const metadata: Metadata = { title: "My account" };
// Rendered client-side after the session check; nothing to validate as an instant navigation.
export const instant = false;


export default function Page() {
  return <AccountPage />;
}
