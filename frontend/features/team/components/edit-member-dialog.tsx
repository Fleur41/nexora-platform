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
import {
  useAssignProperty,
  usePropertyAssignments,
  usePropertyOptions,
  useUnassignProperty,
} from "@/features/properties/api";
import { useCapabilityCatalog, useUpdateMember } from "@/features/team/api";
import { errorMessage } from "@/lib/api/errors";
import { effectiveCapabilities, overridesFor } from "@/features/team/permissions";
import { ASSIGNABLE_ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/roles";
import type { AccessScope, Membership, Role } from "@/types/api";

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

  const [scope, setScope] = React.useState<AccessScope>(member.access_scope);

  const changeRole = (next: Role) => {
    setRole(next);
    const defaultScope = catalog.data?.roles.find((r) => r.key === next)?.default_access_scope;
    if (defaultScope) setScope(defaultScope);
    // Switching role resets to that role's defaults.
    if (catalog.data) setGranted(effectiveCapabilities(catalog.data, next, [], []));
  };

  const roles = ASSIGNABLE_ROLES.filter((r) => r !== "owner" || current.role === "owner");
  // Non-owners cannot grant capabilities they do not hold (enforced by the API as well).
  const grantable = new Set(current.capabilities);

  const save = () => {
    if (!catalog.data || !granted) return;
    update.mutate(
      {
        id: member.id,
        role,
        access_scope: role === "owner" ? "organization" : scope,
        ...overridesFor(catalog.data, role, granted),
      },
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

      {role !== "owner" && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Record access</legend>
          {(["organization", "assigned"] as const).map((value) => {
            // Only members with whole-organization access can grant it (enforced by the API).
            const disabled = value === "organization" && current.role !== "owner" && current.access_scope !== "organization";
            return (
              <label key={value} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm has-[:checked]:border-accent has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
                <input
                  type="radio"
                  name="access_scope"
                  className="mt-0.5 accent-[var(--accent)]"
                  checked={scope === value}
                  disabled={disabled}
                  onChange={() => setScope(value)}
                />
                <span>
                  <span className="block font-medium">
                    {value === "organization" ? "All properties" : "Assigned properties only"}
                  </span>
                  <span className="block text-muted-foreground">
                    {value === "organization"
                      ? "Sees every property, unit, tenant and lease their permissions allow."
                      : "Sees only properties they are assigned to, and the units, tenants and leases on them."}
                  </span>
                </span>
              </label>
            );
          })}
          {scope === "assigned" && member.access_scope === "assigned" && <AssignedProperties membershipId={member.id} />}
          {scope === "assigned" && member.access_scope !== "assigned" && (
            <p className="text-xs text-muted-foreground">Save first, then choose which properties they can access.</p>
          )}
        </fieldset>
      )}

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

/** Property checkboxes for an assigned-scope member. Changes are saved immediately. */
function AssignedProperties({ membershipId }: { membershipId: string }) {
  const properties = usePropertyOptions();
  const assignments = usePropertyAssignments({ membership: membershipId });
  const assign = useAssignProperty();
  const unassign = useUnassignProperty();
  const byProperty = new Map(assignments.data?.map((a) => [a.property, a.id]));
  const busy = assign.isPending || unassign.isPending;

  if (properties.isPending || assignments.isPending) return <Skeleton className="h-20 w-full" />;
  const list = properties.data?.results ?? [];
  if (list.length === 0) {
    return <p className="text-xs text-muted-foreground">No properties yet.</p>;
  }
  return (
    <div className="rounded-lg border">
      <p className="border-b px-3 py-2 text-xs text-muted-foreground">
        Assigned properties ({byProperty.size}) · changes save immediately
      </p>
      <ul className="max-h-48 divide-y overflow-y-auto">
        {list.map((p) => {
          const assignmentId = byProperty.get(p.id);
          return (
            <li key={p.id}>
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--accent)]"
                  checked={Boolean(assignmentId)}
                  disabled={busy}
                  onChange={(e) => {
                    const onError = (err: unknown) => toast.error(errorMessage(err));
                    if (e.target.checked) assign.mutate({ property: p.id, membership: membershipId }, { onError });
                    else if (assignmentId) unassign.mutate(assignmentId, { onError });
                  }}
                />
                {p.name}
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
