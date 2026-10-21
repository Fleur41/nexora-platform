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
      <Toaster richColors position="top-right" closeButton />
    </QueryClientProvider>
  );
}
