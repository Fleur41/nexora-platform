"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as React from "react";
import { useForm } from "react-hook-form";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { useConfirmPasswordReset } from "@/features/auth/api";
import { resetPasswordSchema, type ResetPasswordValues } from "@/features/auth/schemas";
import { ApiError } from "@/lib/api/errors";

export function ResetPasswordForm() {
  const params = useSearchParams();
  const uid = params.get("uid") ?? "";
  const token = params.get("token") ?? "";
  const confirm = useConfirmPasswordReset();
  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { new_password: "", confirm_password: "" },
  });

  React.useEffect(() => {
    const message = confirm.error instanceof ApiError && confirm.error.fieldError("new_password");
    if (message) form.setError("new_password", { message });
  }, [confirm.error, form]);

  if (!uid || !token) {
    return <Alert variant="error" title="This reset link is incomplete or invalid." />;
  }
  if (confirm.isSuccess) {
    return (
      <Alert variant="success" title="Password updated">
        <Link href="/login" className="font-medium underline">
          Sign in with your new password
        </Link>
      </Alert>
    );
  }
  const tokenError = confirm.error instanceof ApiError && confirm.error.fieldError("token");

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={form.handleSubmit((v) =>
        confirm.mutate({ uid, token, new_password: v.new_password }),
      )}
    >
      {tokenError && <Alert variant="error" title={tokenError} />}
      <FormField
        id="new_password"
        label="New password"
        error={form.formState.errors.new_password?.message}
      >
        <Input type="password" autoComplete="new-password" {...form.register("new_password")} />
      </FormField>
      <FormField
        id="confirm_password"
        label="Confirm new password"
        error={form.formState.errors.confirm_password?.message}
      >
        <Input type="password" autoComplete="new-password" {...form.register("confirm_password")} />
      </FormField>
      <Button type="submit" className="w-full" loading={confirm.isPending}>
        Set new password
      </Button>
    </form>
  );
}
