"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { useLogin } from "@/features/auth/api";
import { loginSchema, type LoginValues } from "@/features/auth/schemas";
import { safeNextPath } from "@/lib/navigation";

export function LoginForm() {
  const router = useRouter();
  const next = safeNextPath(useSearchParams().get("next"));
  const login = useLogin();
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = form.handleSubmit((values) =>
    login.mutate(values, { onSuccess: () => router.replace(next) }),
  );

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {login.isError && <Alert variant="error" title={login.error.message} />}
      <FormField id="email" label="Email" error={form.formState.errors.email?.message}>
        <Input type="email" autoComplete="email" {...form.register("email")} />
      </FormField>
      <FormField id="password" label="Password" error={form.formState.errors.password?.message}>
        <Input type="password" autoComplete="current-password" {...form.register("password")} />
      </FormField>
      <div className="flex justify-end">
        <Link href="/forgot-password" className="text-sm text-primary hover:underline">
          Forgot password?
        </Link>
      </div>
      <Button type="submit" className="w-full" loading={login.isPending}>
        Sign in
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        New to Nexora?{" "}
        <Link
          href={next === "/dashboard" ? "/register" : `/register?next=${encodeURIComponent(next)}`}
          className="font-medium text-primary hover:underline"
        >
          Create an account
        </Link>
      </p>
    </form>
  );
}
