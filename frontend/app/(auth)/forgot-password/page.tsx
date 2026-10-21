"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { useRequestPasswordReset } from "@/features/auth/api";

const schema = z.object({ email: z.string().trim().email("Enter a valid email address.") });

export default function ForgotPasswordPage() {
  const reset = useRequestPasswordReset();
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { email: "" },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Reset your password</CardTitle>
        <CardDescription>We&apos;ll email you a secure link to choose a new one.</CardDescription>
      </CardHeader>
      <CardContent>
        {reset.isSuccess ? (
          <Alert variant="success" title="Check your email">
            {reset.data.detail}
          </Alert>
        ) : (
          <form
            noValidate
            className="space-y-4"
            onSubmit={form.handleSubmit((values) => reset.mutate(values))}
          >
            {reset.isError && <Alert variant="error" title={reset.error.message} />}
            <FormField id="email" label="Email" error={form.formState.errors.email?.message}>
              <Input type="email" autoComplete="email" {...form.register("email")} />
            </FormField>
            <Button type="submit" className="w-full" loading={reset.isPending}>
              Send reset link
            </Button>
          </form>
        )}
        <p className="mt-4 text-center text-sm">
          <Link href="/login" className="text-primary hover:underline">
            Back to sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
