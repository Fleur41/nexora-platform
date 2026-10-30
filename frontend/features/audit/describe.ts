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
  "property.created": "Property added",
  "property.updated": "Property updated",
  "property.assigned": "Staff assigned to property",
  "property.unassigned": "Staff removed from property",
  "unit_type.created": "Unit type added",
  "unit_type.updated": "Unit type updated",
  "unit_type.deleted": "Unit type deleted",
  "unit.created": "Unit added",
  "unit.bulk_created": "Units added",
  "unit.updated": "Unit updated",
  "unit.deleted": "Unit deleted",
  "unit.status_changed": "Unit status changed",
  "tenant.created": "Tenant registered",
  "tenant.updated": "Tenant updated",
  "tenant.archived": "Tenant archived",
  "tenant.restored": "Tenant restored",
  "lease.created": "Lease created",
  "lease.updated": "Draft lease updated",
  "lease.activated": "Lease activated",
  "lease.cancelled": "Draft lease cancelled",
  "lease.ended": "Lease ended",
  "lease.rent_scheduled": "Rent change scheduled",
  "lease.rent_unscheduled": "Scheduled rent change removed",
  "document.uploaded": "Document uploaded",
  "document.deleted": "Document removed",
  "billing.run": "Billing run",
  "billing.settings_updated": "Billing settings changed",
  "invoice.created": "One-off invoice raised",
  "invoice.voided": "Invoice voided",
  "invoice.credited": "Invoice credited",
  "charge_type.created": "Charge type added",
  "charge_type.updated": "Charge type updated",
  "charge_rule.created": "Charge rule added",
  "charge_rule.updated": "Charge rule updated",
  "charge_rule.ended": "Charge rule ended",
  "charge_rule.deleted": "Charge rule deleted",
  "shared_cost.created": "Shared cost added",
  "shared_cost.deleted": "Shared cost deleted",
  "meter.created": "Meter added",
  "meter.updated": "Meter updated",
  "meter.deactivated": "Meter deactivated",
  "meter.reading_recorded": "Meter reading recorded",
  "meter.reading_updated": "Meter reading corrected",
  "meter.reading_deleted": "Meter reading deleted",
  "deposit.received": "Deposit received",
  "deposit.deduction": "Deposit deduction",
  "deposit.refund": "Deposit refunded",
  "deposit.reversal": "Deposit transaction reversed",
  "demo.seeded": "Sample data created",
  "payment.recorded": "Payment recorded",
  "payment.matched": "Payment matched to a lease",
  "payment.credit_applied": "Credit applied to invoices",
  "payment.allocation_moved": "Payment moved between invoices",
  "payment.reversed": "Payment reversed",
  "payment.refunded": "Credit refunded",
  "payment.stk_requested": "M-Pesa payment requested",
  "payment.statement_imported": "Bank statement imported",
  "payment_settings.created": "Payment method added",
  "payment_settings.updated": "Payment method updated",
  "payment_settings.credentials_saved": "M-Pesa credentials saved",
  "payment_settings.connection_tested": "M-Pesa connection tested",
  "payment_settings.c2b_registered": "M-Pesa callback URLs registered",
  "subscription.invoiced": "Nexora invoice issued",
  "subscription.paid": "Nexora invoice paid",
  "subscription.plan_changed": "Nexora plan changed",
  "subscription.stk_requested": "Nexora M-Pesa payment requested",
  "support.started": "Nexora support session started",
  "support.ended": "Nexora support session ended",
  "support.request": "Nexora support viewed",
  "platform.subscription_updated": "Subscription updated by Nexora",
  "platform.organization_suspended": "Organization suspended by Nexora",
  "platform.organization_reactivated": "Organization reactivated by Nexora",
  "platform.invoice_voided": "Nexora invoice voided",
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
