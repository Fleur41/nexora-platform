"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { MailPlus } from "lucide-react";
import * as React from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { useOrganization } from "@/components/providers/organization-provider";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input, NativeSelect } from "@/components/ui/input";
import { useInviteMember } from "@/features/team/api";
import { ApiError } from "@/lib/api/errors";
import { ASSIGNABLE_ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/roles";
import type { Role } from "@/types/api";

const schema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  role: z.enum(["owner", "property_manager", "accountant", "caretaker"]),
});
type Values = z.infer<typeof schema>;

export function InviteDialog() {
  const [open, setOpen] = React.useState(false);
  const { current } = useOrganization();
  const invite = useInviteMember();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", role: "property_manager" },
  });
  const role: Role = useWatch({ control: form.control, name: "role" });
  // Only owners can grant the owner role; the API enforces this too.
  const roles = ASSIGNABLE_ROLES.filter((r) => r !== "owner" || current.role === "owner");

  const onSubmit = form.handleSubmit((values) =>
    invite.mutate(values, {
      onSuccess: (invitation) => {
        toast.success(`Invitation sent to ${invitation.email}`);
        form.reset();
        setOpen(false);
      },
      onError: (err) => {
        const message = err instanceof ApiError && err.fieldError("email");
        if (message) form.setError("email", { message });
      },
    }),
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) invite.reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <MailPlus /> Invite member
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a team member</DialogTitle>
          <DialogDescription>
            They&apos;ll get an email link to join {current.organization.name}. Links expire after
            7 days.
          </DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={onSubmit} className="space-y-4">
          {invite.isError && !(invite.error instanceof ApiError && invite.error.fieldError("email")) && (
            <Alert variant="error" title={invite.error.message} />
          )}
          <FormField id="invite-email" label="Email" error={form.formState.errors.email?.message}>
            <Input type="email" autoComplete="off" {...form.register("email")} />
          </FormField>
          <FormField id="invite-role" label="Role" hint={ROLE_DESCRIPTIONS[role]}>
            <NativeSelect {...form.register("role")}>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={invite.isPending}>
              Send invitation
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
