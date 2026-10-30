"use client";

import { ErrorState } from "@/components/ui/states";

export default function ListingsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-16 sm:px-6">
      <ErrorState message="Homes couldn't be loaded just now. Please try again in a moment." onRetry={reset} />
    </div>
  );
}
