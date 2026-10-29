import type { Metadata } from "next";

import { NexoraMark } from "@/components/brand/logo";

export const metadata: Metadata = { title: "Offline" };

// Static page cached by the portal service worker and shown when a page can't load offline.
export default function PortalOfflinePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-muted/40 p-6 text-center">
      <NexoraMark className="size-12" />
      <h1 className="text-xl font-semibold">You&apos;re offline</h1>
      <p className="max-w-xs text-sm text-muted-foreground">
        Your bills, receipts and repairs load when you&apos;re back online. Nothing is stored on this
        phone, to keep your account private.
      </p>
      <a href="/portal" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Try again</a>
    </main>
  );
}
