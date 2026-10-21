"use client";

import * as React from "react";
import { toast } from "sonner";

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
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { NativeSelect } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useCapabilityCatalog, useUpdateMember } from "@/features/team/api";
import { effectiveCapabilities, overridesFor } from "@/features/team/permissions";
import { ASSIGNABLE_ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/roles";
import type { Membership, Role } from "@/types/api";

export function EditMemberDialog({
  member,
  onOpenChange,
}: {
  member: Membership | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={member !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        {member && <EditMemberForm member={member} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function EditMemberForm({ member, onDone }: { member: Membership; onDone: () => void }) {
  const { current } = useOrganization();
  const catalog = useCapabilityCatalog();
  const update = useUpdateMember();
  const [role, setRole] = React.useState<Role>(member.role);
  // null = untouched, i.e. show the member's current effective capabilities.
  const [edited, setGranted] = React.useState<Set<string> | null>(null);
  const granted =
    edited ??
    (catalog.data
      ? effectiveCapabilities(
          catalog.data,
          member.role,
          member.extra_permissions,
          member.revoked_permissions,
        )
      : null);

  const changeRole = (next: Role) => {
    setRole(next);
    // Switching role resets to that role's defaults.
    if (catalog.data) setGranted(effectiveCapabilities(catalog.data, next, [], []));
  };

  const roles = ASSIGNABLE_ROLES.filter((r) => r !== "owner" || current.role === "owner");
  // Non-owners cannot grant capabilities they do not hold (enforced by the API as well).
  const grantable = new Set(current.capabilities);

  const save = () => {
    if (!catalog.data || !granted) return;
    update.mutate(
      { id: member.id, role, ...overridesFor(catalog.data, role, granted) },
      {
        onSuccess: () => {
          toast.success(`Updated access for ${member.user.full_name}`);
          onDone();
        },
      },
    );
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit access</DialogTitle>
        <DialogDescription>
          {member.user.full_name} · {member.user.email}
        </DialogDescription>
      </DialogHeader>
      {update.isError && <Alert variant="error" title={update.error.message} />}
      <FormField id="member-role" label="Role" hint={ROLE_DESCRIPTIONS[role]}>
        <NativeSelect value={role} onChange={(e) => changeRole(e.target.value as Role)}>
          {roles.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </NativeSelect>
      </FormField>

      <div className="space-y-2">
        <p className="text-sm font-medium">Permissions</p>
        {catalog.isPending || !granted ? (
          <Skeleton className="h-40 w-full" />
        ) : catalog.isError ? (
          <Alert variant="error" title="Could not load the permission list." />
        ) : role === "owner" ? (
          <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
            Owners always have every permission.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {catalog.data.capabilities.map((cap) => {
              const checked = granted.has(cap.key);
              const disabled = current.role !== "owner" && !grantable.has(cap.key) && !checked;
              return (
                <li key={cap.key}>
                  <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5 text-sm has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 accent-[var(--accent)]"
                      checked={checked}
                      disabled={disabled}
                      onChange={(e) => {
                        const next = new Set(granted);
                        if (e.target.checked) next.add(cap.key);
                        else next.delete(cap.key);
                        setGranted(next);
                      }}
                    />
                    <span>
                      <span className="block">{cap.label}</span>
                      <span className="block font-mono text-xs text-muted-foreground">{cap.key}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button onClick={save} loading={update.isPending} disabled={!granted}>
          Save changes
        </Button>
      </DialogFooter>
    </>
  );
}
