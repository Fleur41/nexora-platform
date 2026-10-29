"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { useForm } from "react-hook-form";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { useRegister } from "@/features/auth/api";
import { registerSchema, type RegisterValues } from "@/features/auth/schemas";
import { ApiError } from "@/lib/api/errors";
import { safeNextPath } from "@/lib/navigation";

export function RegisterForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNextPath(params.get("next"), "/onboarding");
  const register = useRegister();
  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { full_name: "", email: params.get("email") ?? "", phone: "", password: "" },
  });

  React.useEffect(() => {
    // Surface Django's field-level validation errors on the matching inputs.
    if (register.error instanceof ApiError) {
      for (const field of ["full_name", "email", "phone", "password"] as const) {
        const message = register.error.fieldError(field);
        if (message) form.setError(field, { message });
      }
    }
  }, [register.error, form]);

  const onSubmit = form.handleSubmit((values) =>
    register.mutate(values, { onSuccess: () => router.replace(next) }),
  );
  const errors = form.formState.errors;
  const hasFieldErrors =
    register.error instanceof ApiError && Object.keys(register.error.details).length > 0;

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {register.isError && !hasFieldErrors && (
        <Alert variant="error" title={register.error.message} />
      )}
      <FormField id="full_name" label="Full name" error={errors.full_name?.message}>
        <Input autoComplete="name" {...form.register("full_name")} />
      </FormField>
      <FormField id="email" label={next.startsWith("/portal") ? "Email" : "Work email"} error={errors.email?.message}>
        <Input type="email" autoComplete="email" {...form.register("email")} />
      </FormField>
      <FormField id="phone" label="Phone (optional)" error={errors.phone?.message}>
        <Input type="tel" autoComplete="tel" placeholder="07XX XXX XXX" {...form.register("phone")} />
      </FormField>
      <FormField
        id="password"
        label="Password"
        error={errors.password?.message}
        hint="At least 10 characters. Avoid common or purely numeric passwords."
      >
        <Input type="password" autoComplete="new-password" {...form.register("password")} />
      </FormField>
      <Button type="submit" className="w-full" loading={register.isPending}>
        Create account
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link
          href={next === "/onboarding" ? "/login" : `/login?next=${encodeURIComponent(next)}`}
          className="font-medium text-primary hover:underline"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
