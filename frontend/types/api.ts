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
  portal_status: "none" | "invited" | "active";
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
  /** Bill the first period in full instead of prorating it from the start date. */
  first_month_in_full: boolean;
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
export type DocumentTarget = "property" | "unit" | "tenant" | "lease" | "maintenance_request" | "inspection";

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
  maintenance_request: UUID | null;
  inspection: UUID | null;
  uploaded_by_name: string;
  created_at: string;
}

// --- Billing ---------------------------------------------------------------------

export type IncomeCategory = "rental_income" | "utility_recovery" | "service_charge" | "other_income";
export type MeterUtility = "water" | "electricity" | "gas";

export interface ChargeType {
  id: UUID;
  code: string;
  name: string;
  income_category: IncomeCategory;
  meter_utility: MeterUtility | "";
  is_system: boolean;
  is_active: boolean;
}

export type RuleScope = "organization" | "property" | "unit_type" | "unit";
export type RuleMethod = "fixed_monthly" | "one_time" | "metered" | "shared";

export interface ChargeRule {
  id: UUID;
  charge_type: UUID;
  charge_type_name: string;
  scope: RuleScope;
  property: UUID | null;
  unit_type: UUID | null;
  unit: UUID | null;
  target_name: string;
  method: RuleMethod;
  amount: string;
  usage_unit: string;
  is_enabled: boolean;
  included_in_rent: boolean;
  effective_from: string;
  effective_to: string | null;
  description: string;
  is_billed: boolean;
  created_at: string;
}

export interface ResolvedCharges {
  unit: UUID;
  date: string;
  charges: {
    charge_type: UUID;
    charge_type_name: string;
    rule: UUID;
    scope: RuleScope;
    method: RuleMethod;
    amount: string;
    usage_unit: string;
    is_enabled: boolean;
    included_in_rent: boolean;
    billable: boolean;
  }[];
}

export interface BillingSettings {
  auto_generate: boolean;
  generate_day: number;
}

export interface SharedCost {
  id: UUID;
  property: UUID;
  property_name: string;
  charge_type: UUID;
  charge_type_name: string;
  period: string;
  total_amount: Money;
  description: string;
  allocated_amount: Money;
  allocated_units: number;
  created_at: string;
}

export interface BillingRun {
  id: UUID;
  period: string;
  trigger: "manual" | "scheduled";
  invoices_created: number;
  lines_created: number;
  total_billed: Money;
  skipped: string[];
  created_by_name: string;
  created_at: string;
}

export interface BillingPreview {
  period: string;
  invoice_count: number;
  total: Money;
  notes: string[];
  invoices: {
    lease: UUID;
    lease_reference: string;
    tenant_name: string;
    unit_number: string;
    property_name: string;
    kind: InvoiceKind;
    period_start: string;
    period_end: string;
    due_date: string;
    total: Money;
    lines: { description: string; amount: Money }[];
  }[];
}

export type InvoiceKind = "regular" | "supplementary" | "one_off";

export interface Invoice {
  id: UUID;
  number: string;
  kind: InvoiceKind;
  status: "issued" | "void";
  lease: UUID;
  lease_reference: string;
  tenant: UUID;
  tenant_name: string;
  unit: UUID;
  unit_number: string;
  property_name: string;
  period_start: string | null;
  period_end: string | null;
  issue_date: string;
  due_date: string;
  currency: string;
  total: Money;
  amount_due: Money;
  created_at: string;
}

export interface InvoiceLine {
  id: UUID;
  charge_type: UUID;
  charge_type_name: string;
  description: string;
  quantity: string;
  unit_price: string;
  amount: Money;
  income_category: IncomeCategory;
  period_start: string | null;
  period_end: string | null;
  is_void: boolean;
}

export interface LedgerEntry {
  id: UUID;
  entry_type: "invoice" | "credit" | "void" | "payment" | "allocation" | "payment_reversal" | "refund";
  amount: Money;
  invoice: UUID | null;
  invoice_number: string | null;
  reference: string;
  effective_date: string;
  description: string;
  reason: string;
  created_by_name: string;
  created_at: string;
  balance?: Money;
}

export interface InvoiceDetail extends Invoice {
  notes: string;
  lines: InvoiceLine[];
  ledger_entries: LedgerEntry[];
  created_by_name: string;
  voided_at: string | null;
  voided_by_name: string;
  void_reason: string;
}

export interface LeaseAccount {
  lease: UUID;
  currency: string;
  balance: Money;
  overdue: Money;
  opening_balance: Money;
  closing_balance: Money;
  entries: (LedgerEntry & { balance: Money })[];
}

export interface TenantAccount {
  tenant: UUID;
  currency: string;
  balance: Money;
  leases: {
    lease: UUID;
    reference: string;
    status: LeaseStatus;
    unit_number: string;
    property_name: string;
    balance: Money;
  }[];
}

export interface BillingSummary {
  currency: string;
  month: string;
  billed_this_month: Money;
  outstanding: Money;
  outstanding_invoices: number;
  overdue: Money;
  overdue_invoices: number;
}

// --- Utilities -------------------------------------------------------------------

export interface Meter {
  id: UUID;
  unit: UUID;
  unit_number: string;
  property_id: UUID;
  property_name: string;
  utility: MeterUtility;
  number: string;
  is_active: boolean;
  last_reading_date: string | null;
  last_reading_value: string | null;
  created_at: string;
}

export interface MeterReading {
  id: UUID;
  meter: UUID;
  utility: MeterUtility;
  unit_number: string;
  reading_date: string;
  value: string;
  is_estimate: boolean;
  note: string;
  is_billed: boolean;
  recorded_by_name: string;
  created_at: string;
}

// --- Deposits --------------------------------------------------------------------

export type DepositKind = "received" | "deduction" | "refund" | "reversal";
export type PaymentMethod = "cash" | "mpesa" | "bank" | "cheque" | "other" | "";

export interface DepositSummary {
  lease: UUID;
  lease_reference: string;
  lease_status: LeaseStatus;
  tenant_name: string;
  unit_number: string;
  property_name: string;
  agreed: Money;
  received: Money;
  deducted: Money;
  refunded: Money;
  held: Money;
  outstanding: Money;
}

export interface DepositTransaction {
  id: UUID;
  kind: DepositKind;
  amount: Money;
  transaction_date: string;
  method: PaymentMethod;
  reference: string;
  reason: string;
  reverses: UUID | null;
  reverses_kind: DepositKind | null;
  is_reversed: boolean;
  created_by_name: string;
  created_at: string;
}

export interface DepositDetail extends DepositSummary {
  transactions: DepositTransaction[];
}

// --- Payments ----------------------------------------------------------------------

export type PaymentProvider = "mpesa_paybill" | "mpesa_till" | "bank" | "cash" | "other";
export type PaymentMethodKind = "mpesa" | "bank" | "cash" | "cheque" | "other";
export type IntegrationStatus = "not_configured" | "credentials_saved" | "verified" | "failed";

export interface PaymentConfiguration {
  id: UUID;
  provider: PaymentProvider;
  method: PaymentMethodKind;
  display_name: string;
  property: UUID | null;
  property_name: string | null;
  shortcode: string;
  account_reference_hint: string;
  bank_name: string;
  bank_branch: string;
  account_name: string;
  account_number: string;
  instructions: string;
  currency: string;
  is_enabled: boolean;
  valid_from: string | null;
  valid_to: string | null;
  environment: "sandbox" | "production";
  integration_status: IntegrationStatus;
  integration_message: string;
  integration_checked_at: string | null;
  c2b_registered_at: string | null;
  has_credentials: boolean;
  has_passkey: boolean;
  callback_urls: { confirmation: string; validation: string; stk_callback: string } | null;
  created_at: string;
  updated_at: string;
}

export type PaymentSource = "manual" | "mpesa_c2b" | "mpesa_stk" | "bank_import";

export interface Payment {
  id: UUID;
  receipt_number: string;
  lease: UUID | null;
  lease_reference: string | null;
  tenant: UUID | null;
  tenant_name: string | null;
  unit_number: string | null;
  property_name: string | null;
  method: PaymentMethodKind;
  configuration_name: string;
  amount: Money;
  unallocated: Money;
  received_on: string;
  reference: string;
  payer_name: string;
  payer_phone: string;
  account_reference: string;
  status: "completed" | "reversed";
  source: PaymentSource;
  is_matched: boolean;
  created_at: string;
}

export interface PaymentDetail extends Payment {
  configuration_snapshot: Record<string, string | null>;
  notes: string;
  allocations: { id: UUID; invoice: UUID; invoice_number: string; amount: Money; is_reversed: boolean; created_at: string }[];
  refunds: {
    id: UUID;
    amount: Money;
    refunded_on: string;
    method: PaymentMethodKind;
    reference: string;
    reason: string;
    created_by_name: string;
    created_at: string;
  }[];
  created_by_name: string;
  matched_at: string | null;
  reversed_at: string | null;
  reversed_by_name: string;
  reversal_reason: string;
}

export interface PaymentsSummary {
  currency: string;
  collected_this_month: Money;
  unmatched_count: number;
  unmatched_amount: Money;
  credit_held: Money;
}

export interface PaymentRequest {
  id: UUID;
  lease: UUID;
  lease_reference: string;
  tenant_name: string;
  phone: string;
  amount: Money;
  status: "pending" | "completed" | "failed" | "expired" | "needs_review";
  result_description: string;
  payment: UUID | null;
  receipt_number: string | null;
  created_at: string;
}

export interface StatementImport {
  id: UUID;
  configuration: UUID;
  configuration_name: string;
  file_name: string;
  rows_total: number;
  rows_created: number;
  rows_matched: number;
  rows_duplicate: number;
  rows_skipped: number;
  errors: string[];
  created_by_name: string;
  created_at: string;
}

export interface ProviderEvent {
  id: UUID;
  event_type: string;
  external_id: string;
  status: "processed" | "duplicate" | "rejected" | "failed";
  message: string;
  receipt_number: string | null;
  created_at: string;
}

export interface PaymentInstructions {
  lease: UUID;
  account_reference: string;
  methods: {
    id: UUID;
    provider: PaymentProvider;
    display_name: string;
    shortcode: string;
    account_number_to_use: string;
    account_reference_hint: string;
    bank_name: string;
    bank_branch: string;
    account_name: string;
    account_number: string;
    instructions: string;
    supports_payment_request: boolean;
  }[];
}

// --- Operations -----------------------------------------------------------------

export type MaintenanceStatus = "submitted" | "acknowledged" | "in_progress" | "on_hold" | "resolved" | "closed" | "cancelled";
export type MaintenanceCategory = "plumbing" | "electrical" | "structural" | "security" | "appliance" | "pest" | "cleaning" | "other";
export type Urgency = "low" | "normal" | "high" | "emergency";

export interface MaintenanceRequest {
  id: UUID;
  reference: string;
  unit: UUID;
  unit_number: string;
  property_id: UUID;
  property_name: string;
  tenant: UUID | null;
  tenant_name: string | null;
  source: "tenant" | "staff" | "inspection";
  category: MaintenanceCategory;
  title: string;
  description: string;
  urgency: Urgency;
  status: MaintenanceStatus;
  assigned_to: UUID | null;
  assigned_to_name: string | null;
  scheduled_for: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MaintenanceUpdate {
  id: UUID;
  author_name: string;
  from_tenant: boolean;
  body: string;
  is_internal: boolean;
  status_from: string;
  status_to: string;
  created_at: string;
}

export interface MaintenanceCost {
  id: UUID;
  kind: "quotation" | "expense";
  supplier_name: string;
  description: string;
  amount: Money;
  status: "pending" | "approved" | "rejected" | "recorded";
  incurred_on: string | null;
  created_at: string;
}

export interface MaintenanceDetail extends MaintenanceRequest {
  updates: MaintenanceUpdate[];
  costs: MaintenanceCost[] | null;
}

export type InspectionKind = "move_in" | "move_out" | "routine";
export type ItemCondition = "not_checked" | "good" | "fair" | "poor" | "damaged" | "missing";

export interface Inspection {
  id: UUID;
  reference: string;
  unit: UUID;
  unit_number: string;
  property_name: string;
  lease: UUID | null;
  lease_reference: string | null;
  tenant_name: string | null;
  kind: InspectionKind;
  status: "scheduled" | "completed" | "cancelled";
  scheduled_for: string;
  inspector: UUID | null;
  inspector_name: string | null;
  summary: string;
  keys_returned: number | null;
  tenant_present: boolean;
  tenant_signature_name: string;
  inspector_signature_name: string;
  completed_at: string | null;
  damages_total: Money;
  created_at: string;
}

export interface InspectionItem {
  id: UUID;
  area: string;
  name: string;
  condition: ItemCondition;
  notes: string;
  charge_amount: Money;
  position: number;
}

export interface InspectionDetail extends Inspection {
  items: InspectionItem[];
}

export type MoveOutStatus = "submitted" | "acknowledged" | "inspection_scheduled" | "completed" | "withdrawn";

export interface MoveOutNotice {
  id: UUID;
  lease: UUID;
  lease_reference: string;
  tenant: UUID;
  tenant_name: string;
  unit_number: string;
  property_name: string;
  intended_date: string;
  message: string;
  from_tenant: boolean;
  status: MoveOutStatus;
  staff_notes: string;
  inspection: UUID | null;
  inspection_reference: string | null;
  inspection_status: string | null;
  settlement: Record<string, string | boolean | string[]>;
  acknowledged_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface SettlementPreview {
  deposit_held: Money;
  damages_found: Money;
  damages_deducted: Money;
  balance_before: Money;
  applied_to_balance: Money;
  refund: Money;
  balance_after: Money;
  move_out_month_billed: boolean;
  notes: string[];
}

export interface InboxNotification {
  id: UUID;
  kind: string;
  title: string;
  body: string;
  link: string;
  organization: UUID | null;
  organization_name: string | null;
  read_at: string | null;
  created_at: string;
}

export interface NotificationSettings {
  email_enabled: boolean;
  sms_enabled: boolean;
  invoice_notifications: boolean;
  receipt_notifications: boolean;
  rent_due_reminder_days: number;
  arrears_reminders: boolean;
  lease_expiry_days: number;
}

export interface Announcement {
  id: UUID;
  title: string;
  body: string;
  property: UUID | null;
  property_name: string | null;
  send_email: boolean;
  send_sms: boolean;
  recipients: number;
  sent_by_name: string;
  created_at: string;
}

export interface DeliveryLogEntry {
  id: UUID;
  kind: string;
  channel: "email" | "sms";
  title: string;
  to_address: string;
  tenant_name: string | null;
  user_name: string | null;
  status: "pending" | "sent" | "failed" | "skipped";
  error: string;
  attempts: number;
  sent_at: string | null;
  created_at: string;
}

// --- Tenant portal --------------------------------------------------------------------

export interface PortalTenancy {
  tenant: UUID;
  full_name: string;
  organization: { id: UUID; name: string; currency: string; timezone: string; phone: string; email: string };
}

export interface PortalInvoice {
  id: UUID;
  number: string;
  kind: string;
  status: "issued" | "void";
  period_start: string | null;
  period_end: string | null;
  issue_date: string;
  due_date: string;
  currency: string;
  total: Money;
  amount_due: Money;
  unit_number: string;
  property_name: string;
  lines?: { description: string; amount: Money }[];
}

export interface PortalPayment {
  id: UUID;
  receipt_number: string;
  amount: Money;
  received_on: string;
  method: string;
  reference: string;
  status: "completed" | "reversed";
  invoices: { number: string; amount: Money }[];
}

export interface PortalMethod {
  provider: PaymentProvider;
  display_name: string;
  shortcode: string;
  account_number_to_use: string;
  bank_name: string;
  bank_branch: string;
  account_name: string;
  account_number: string;
  reference_to_use: string;
  instructions: string;
  supports_payment_request: boolean;
}

export interface PortalLease {
  id: UUID;
  reference: string;
  status: LeaseStatus;
  property_name: string;
  unit_number: string;
  start_date: string;
  end_date: string | null;
  ended_on: string | null;
  monthly_rent: Money | null;
  rent_due_day: number;
  balance: Money;
  credit: Money;
  deposit_held: Money;
  payment_methods: PortalMethod[];
}

export interface PortalSummary {
  tenant: UUID;
  full_name: string;
  currency: string;
  balance: Money;
  overdue: Money;
  next_due: PortalInvoice | null;
  open_invoices: PortalInvoice[];
  recent_payments: PortalPayment[];
  leases: PortalLease[];
  open_maintenance: number;
}

export interface PortalMaintenance {
  id: UUID;
  reference: string;
  unit_number: string;
  property_name: string;
  category: MaintenanceCategory;
  title: string;
  description: string;
  urgency: Urgency;
  status: MaintenanceStatus;
  is_assigned: boolean;
  scheduled_for: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  updates?: { id: UUID; author_name: string; from_tenant: boolean; body: string; status_to: string; created_at: string }[];
  photos?: { id: UUID; title: string }[];
}

export interface PortalMoveOut {
  id: UUID;
  lease: UUID;
  lease_reference: string;
  intended_date: string;
  message: string;
  status: MoveOutStatus;
  inspection_date: string | null;
  created_at: string;
  acknowledged_at: string | null;
  completed_at: string | null;
}

// --- Reports ----------------------------------------------------------------------------

export type ReportKey = "financial-summary" | "rent-roll" | "arrears" | "occupancy" | "deposits" | "maintenance-costs";
export type ReportValueKind = "text" | "date" | "money" | "number" | "percent";

export interface ReportListItem {
  key: ReportKey;
  title: string;
  description: string;
  available: boolean;
}

export interface ReportColumn {
  key: string;
  label: string;
  kind: ReportValueKind;
}

export type ReportCell = string | number | null;

export interface ReportSection {
  title: string;
  note: string;
  columns: ReportColumn[];
  rows: Record<string, ReportCell>[];
  totals: Record<string, ReportCell> | null;
}

export interface Report {
  key: ReportKey;
  title: string;
  subtitle: string;
  organization: string;
  currency: string;
  period: { start: string; end: string; label: string };
  property: string | null;
  summary: { label: string; value: string | null; kind: ReportValueKind }[];
  sections: ReportSection[];
  chart?: { label: string; month: string; billed: Money; collected: Money }[];
}
