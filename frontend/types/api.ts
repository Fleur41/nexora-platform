// Types mirroring the Django REST API (backend/apps/*/serializers.py).

export type UUID = string;

export interface User {
  id: UUID;
  email: string;
  full_name: string;
  phone: string;
  is_platform_admin: boolean;
  date_joined: string;
}

export type Role = "owner" | "property_manager" | "accountant" | "caretaker";

export interface Organization {
  id: UUID;
  name: string;
  slug: string;
  legal_name: string;
  email: string;
  phone: string;
  address: string;
  country: string;
  currency: string;
  timezone: string;
  status: "active" | "suspended";
  created_at: string;
}

/** An organization as seen by the current user. */
export interface MyOrganization {
  organization: Organization;
  membership_id: UUID;
  role: Role;
  capabilities: string[];
}

export interface Membership {
  id: UUID;
  user: User;
  role: Role;
  status: "active" | "suspended" | "removed";
  extra_permissions: string[];
  revoked_permissions: string[];
  capabilities: string[];
  joined_at: string;
}

export interface Invitation {
  id: UUID;
  email: string;
  role: Role;
  status: "pending" | "accepted" | "revoked";
  expires_at: string;
  is_expired: boolean;
  invited_by_name: string;
  created_at: string;
}

export interface InvitationPreview {
  organization_name: string;
  email: string;
  role: Role;
  role_label: string;
  invited_by_name: string;
  expires_at: string;
  is_usable: boolean;
}

export interface CapabilityCatalog {
  capabilities: { key: string; label: string; module: string }[];
  roles: { key: Role; label: string; default_capabilities: string[] }[];
}

export interface AuditLogEntry {
  id: UUID;
  action: string;
  actor_email: string;
  target_type: string;
  target_id: string;
  target_repr: string;
  changes: Record<string, { from: unknown; to: unknown }>;
  metadata: Record<string, unknown>;
  ip_address: string | null;
  request_id: string;
  created_at: string;
}

export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, string[] | string>;
  };
}
