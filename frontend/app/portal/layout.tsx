import type { Metadata, Viewport } from "next";

import { ServiceWorkerRegistration } from "@/features/portal/components/install-prompt";

// The tenant portal installs as its own home-screen app ("Nexora Tenant"), separate from the
// staff dashboard: its own manifest, start URL and scope.
export const metadata: Metadata = {
  title: { default: "My home", template: "%s · Nexora" },
  manifest: "/portal.webmanifest",
  appleWebApp: { capable: true, title: "My home", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
  robots: { index: false },
};

export const viewport: Viewport = {
  themeColor: "#0b2545",
  // Draw under the notch/home indicator; the shell pads with env(safe-area-inset-*).
  viewportFit: "cover",
};

export default function PortalRootLayout({ children }: LayoutProps<"/portal">) {
  return (
    <>
      <ServiceWorkerRegistration />
      {children}
    </>
  );
}
