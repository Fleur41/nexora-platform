"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { Toaster } from "sonner";

import { ApiError } from "@/lib/api/errors";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            // Retrying auth/permission/validation failures never helps.
            retry: (count, error) =>
              !(error instanceof ApiError && error.status >= 400 && error.status < 500) &&
              count < 2,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      {children}
      {/* On phones, clear the tenant app's bottom tab bar. */}
      <Toaster richColors position="bottom-right" closeButton mobileOffset={{ bottom: "calc(4.5rem + env(safe-area-inset-bottom))" }} />
    </QueryClientProvider>
  );
}
