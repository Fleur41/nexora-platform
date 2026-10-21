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
export type AccessScope = "organization" | "assigned";
/** Decimal amounts are serialized as strings (e.g. "25000.00") to avoid float rounding. */
export type Money = string;

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
  access_scope: AccessScope;
  capabilities: string[];
}

export interface Membership {
  id: UUID;
  user: User;
  role: Role;
  status: "active" | "suspended" | "removed";
  access_scope: AccessScope;
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
  access_scopes: { key: AccessScope; label: string }[];
  roles: {
    key: Role;
    label: string;
    default_access_scope: AccessScope;
    default_capabilities: string[];
  }[];
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

// --- Property module ---------------------------------------------------------

export type PropertyType =
  | "apartments"
  | "estate"
  | "maisonettes"
  | "hostel"
  | "commercial"
  | "mixed_use"
  | "other";

export interface Property {
  id: UUID;
  name: string;
  reference: string;
  slug: string;
  property_type: PropertyType;
  address_line: string;
  town: string;
  county: string;
  country: string;
  latitude: string | null;
  longitude: string | null;
  map_url: string;
  description: string;
  amenities: string[];
  is_listed_publicly: boolean;
  is_active: boolean;
  unit_count: number;
  occupied_count: number;
  available_count: number;
  created_at: string;
  updated_at: string;
}

export type UnitCategory =
  | "bedsitter"
  | "studio"
  | "one_bedroom"
  | "two_bedroom"
  | "three_bedroom"
  | "four_bedroom"
  | "shop"
  | "custom";

export interface UnitType {
  id: UUID;
  property: UUID;
  name: string;
  category: UnitCategory;
  bedrooms: number;
  bathrooms: number;
  default_rent: Money;
  default_deposit: Money;
  description: string;
  is_active: boolean;
  unit_count: number;
  created_at: string;
}

export type UnitStatus =
  | "available"
  | "reserved"
  | "occupied"
  | "notice_submitted"
  | "awaiting_inspection"
  | "under_maintenance"
  | "unavailable";

export interface Unit {
  id: UUID;
  property: UUID;
  property_name: string;
  unit_type: UUID;
  unit_type_name: string;
  number: string;
  floor: string;
  status: UnitStatus;
  market_rent: Money;
  water_meter_number: string;
  electricity_meter_number: string;
  notes: string;
  current_lease: { id: UUID; reference: string; tenant_name?: string } | null;
  created_at: string;
  updated_at: string;
}

export interface UnitSummary {
  total: number;
  by_status: Record<UnitStatus, number>;
  occupied: number;
  vacant: number;
  occupancy_rate: number | null;
}

export interface PropertyAssignment {
  id: UUID;
  property: UUID;
  property_name: string;
  membership: UUID;
  member_name: string;
  member_email: string;
  created_at: string;
}

export type TenantIdType =
  | "national_id"
  | "passport"
  | "alien_id"
  | "company_registration"
  | "other";

export interface Tenant {
  id: UUID;
  full_name: string;
  email: string;
  phone: string;
  alternate_phone: string;
  /** Sensitive fields are omitted unless the member can manage tenants. */
  id_type?: TenantIdType;
  id_number?: string;
  kra_pin?: string;
  occupation?: string;
  employer?: string;
  notes?: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  status: "active" | "archived";
  active_lease_count: number;
  created_at: string;
  updated_at: string;
}

export type LeaseStatus = "draft" | "active" | "ended" | "cancelled";
export type BillingFrequency = "monthly" | "quarterly" | "semi_annual" | "annual";

export interface RentTerm {
  id: UUID;
  effective_from: string;
  monthly_rent: Money;
  note: string;
  created_at: string;
}

export interface Lease {
  id: UUID;
  reference: string;
  status: LeaseStatus;
  tenant: UUID;
  tenant_name: string;
  tenant_phone: string;
  unit: UUID;
  unit_number: string;
  property_id: UUID;
  property_name: string;
  start_date: string;
  end_date: string | null;
  ended_on: string | null;
  billing_frequency: BillingFrequency;
  rent_due_day: number;
  deposit_amount: Money;
  current_rent: Money | null;
  rent_terms: RentTerm[];
  notes: string;
  end_reason: string;
  activated_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type DocumentCategory = "photo" | "lease_agreement" | "identity" | "inspection" | "other";
export type DocumentTarget = "property" | "unit" | "tenant" | "lease";

export interface NexoraDocument {
  id: UUID;
  category: DocumentCategory;
  title: string;
  original_filename: string;
  content_type: string;
  size: number;
  target_type: DocumentTarget;
  property: UUID | null;
  unit: UUID | null;
  tenant: UUID | null;
  lease: UUID | null;
  uploaded_by_name: string;
  created_at: string;
}
