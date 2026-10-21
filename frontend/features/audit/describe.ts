import type { AuditLogEntry } from "@/types/api";

const LABELS: Record<string, string> = {
  "organization.created": "Organization created",
  "organization.updated": "Organization settings updated",
  "membership.created": "Member added",
  "membership.updated": "Member role or permissions changed",
  "membership.removed": "Member removed",
  "membership.reactivated": "Member re-joined",
  "invitation.created": "Invitation sent",
  "invitation.resent": "Invitation resent",
  "invitation.revoked": "Invitation revoked",
  "invitation.accepted": "Invitation accepted",
};

export function describeAction(entry: AuditLogEntry): string {
  const label = LABELS[entry.action] ?? entry.action;
  return entry.target_repr ? `${label}: ${entry.target_repr}` : label;
}

export function describeChanges(entry: AuditLogEntry): string[] {
  return Object.entries(entry.changes).map(
    ([field, change]) => `${field}: ${format(change.from)} → ${format(change.to)}`,
  );
}

function format(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "none";
  return String(value);
}
