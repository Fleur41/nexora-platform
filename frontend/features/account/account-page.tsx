"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import * as React from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { useChangePassword, useMe, useUpdateProfile } from "@/features/auth/api";
import { changePasswordSchema, type ChangePasswordValues } from "@/features/auth/schemas";
import { ApiError } from "@/lib/api/errors";
import type { User } from "@/types/api";

const profileSchema = z.object({
  full_name: z.string().trim().min(2, "Enter your full name.").max(150),
  phone: z.string().trim().max(32),
});

export function AccountPage() {
  const me = useMe();
  if (!me.data) return null; // The dashboard shell only renders for signed-in users.
  return (
    <>
      <PageHeader title="My account" description={me.data.email} />
      <div className="grid max-w-3xl gap-6">
        <ProfileCard user={me.data} />
        <PasswordCard />
      </div>
    </>
  );
}

function ProfileCard({ user }: { user: User }) {
  const update = useUpdateProfile();
  const form = useForm<z.infer<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    defaultValues: { full_name: user.full_name, phone: user.phone },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>Your email address is your sign-in and cannot be changed here.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          className="space-y-4"
          onSubmit={form.handleSubmit((v) =>
            update.mutate(v, { onSuccess: () => toast.success("Profile updated") }),
          )}
        >
          {update.isError && <Alert variant="error" title={update.error.message} />}
          <FormField id="full_name" label="Full name" error={form.formState.errors.full_name?.message}>
            <Input autoComplete="name" {...form.register("full_name")} />
          </FormField>
          <FormField id="phone" label="Phone" error={form.formState.errors.phone?.message}>
            <Input type="tel" autoComplete="tel" {...form.register("phone")} />
          </FormField>
          <Button type="submit" loading={update.isPending}>
            Save profile
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function PasswordCard() {
  const change = useChangePassword();
  const form = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { current_password: "", new_password: "", confirm_password: "" },
  });

  React.useEffect(() => {
    if (!(change.error instanceof ApiError)) return;
    for (const field of ["current_password", "new_password"] as const) {
      const message = change.error.fieldError(field);
      if (message) form.setError(field, { message });
    }
  }, [change.error, form]);

  const errors = form.formState.errors;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          className="space-y-4"
          onSubmit={form.handleSubmit(({ current_password, new_password }) =>
            change.mutate(
              { current_password, new_password },
              {
                onSuccess: () => {
                  toast.success("Password changed");
                  form.reset();
                },
              },
            ),
          )}
        >
          <FormField id="current_password" label="Current password" error={errors.current_password?.message}>
            <Input type="password" autoComplete="current-password" {...form.register("current_password")} />
          </FormField>
          <FormField id="new_password" label="New password" error={errors.new_password?.message}>
            <Input type="password" autoComplete="new-password" {...form.register("new_password")} />
          </FormField>
          <FormField id="confirm_password" label="Confirm new password" error={errors.confirm_password?.message}>
            <Input type="password" autoComplete="new-password" {...form.register("confirm_password")} />
          </FormField>
          <Button type="submit" loading={change.isPending}>
            Change password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
