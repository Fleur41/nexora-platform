import Link from "next/link";

import { NexoraLogo } from "@/components/brand/logo";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-screen flex-col bg-muted/40">
      <header className="px-4 py-6 sm:px-8">
        <Link href="/" aria-label="Nexora home">
          <NexoraLogo />
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-4 sm:pt-12">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
