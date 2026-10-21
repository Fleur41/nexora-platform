import type { Metadata } from "next";
import { Suspense } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RegisterForm } from "@/features/auth/components/register-form";

export const metadata: Metadata = { title: "Create your account" };

export default function RegisterPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Create your Nexora account</CardTitle>
        <CardDescription>
          You&apos;ll set up your organization right after this step.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <RegisterForm />
        </Suspense>
      </CardContent>
    </Card>
  );
}
