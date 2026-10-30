import type {
  BillingFrequency,
  Inspection,
  InspectionKind,
  ItemCondition,
  MaintenanceCategory,
  MaintenanceStatus,
  MoveOutStatus,
  Urgency,
  IntegrationStatus,
  PaymentProvider,
  PaymentSource,
  DepositKind,
  EnquiryOutcome,
  EnquiryStatus,
  ExpenseCategory,
  TimeOfDay,
  InvoiceKind,
  MeterUtility,
  PaymentMethod,
  RuleMethod,
  RuleScope,
  DocumentCategory,
  LeaseStatus,
  PropertyType,
  TenantIdType,
  UnitCategory,
  UnitStatus,
} from "@/types/api";

export const UNIT_STATUS: Record<UnitStatus, { label: string; tile: string; dot: string }> = {
  available: { label: "Available", tile: "border-accent/40 bg-accent/10 text-accent-strong", dot: "bg-accent" },
  reserved: { label: "Reserved", tile: "border-sky-300 bg-sky-50 text-sky-800", dot: "bg-sky-500" },
  occupied: { label: "Occupied", tile: "border-primary/30 bg-primary/10 text-primary", dot: "bg-primary" },
  notice_submitted: { label: "Notice submitted", tile: "border-warning/40 bg-warning/10 text-warning-strong", dot: "bg-warning" },
  awaiting_inspection: { label: "Awaiting inspection", tile: "border-violet-300 bg-violet-50 text-violet-800", dot: "bg-violet-500" },
  under_maintenance: { label: "Under maintenance", tile: "border-orange-300 bg-orange-50 text-orange-800", dot: "bg-orange-500" },
  unavailable: { label: "Unavailable", tile: "border-border bg-muted text-muted-foreground", dot: "bg-muted-foreground" },
};

/** Statuses staff may set by hand (mirrors Unit.MANUAL_STATUSES). */
export const MANUAL_UNIT_STATUSES: UnitStatus[] = ["available", "under_maintenance", "unavailable"];
/** Statuses a unit can take after a lease ends (mirrors Unit.POST_LEASE_STATUSES). */
export const POST_LEASE_UNIT_STATUSES: UnitStatus[] = [
  "available",
  "awaiting_inspection",
  "under_maintenance",
  "unavailable",
];

export const UNIT_CATEGORY: Record<UnitCategory, string> = {
  bedsitter: "Bedsitter",
  studio: "Studio",
  one_bedroom: "One bedroom",
  two_bedroom: "Two bedroom",
  three_bedroom: "Three bedroom",
  four_bedroom: "Four bedroom",
  shop: "Shop / commercial",
  custom: "Custom",
};

export const PROPERTY_TYPE: Record<PropertyType, string> = {
  apartments: "Apartment block",
  estate: "Estate / gated community",
  maisonettes: "Maisonettes / townhouses",
  hostel: "Hostel",
  commercial: "Commercial",
  mixed_use: "Mixed use",
  other: "Other",
};

export const LEASE_STATUS: Record<
  LeaseStatus,
  { label: string; variant: "accent" | "muted" | "default" | "warning" }
> = {
  draft: { label: "Draft", variant: "warning" },
  active: { label: "Active", variant: "accent" },
  ended: { label: "Ended", variant: "muted" },
  cancelled: { label: "Cancelled", variant: "muted" },
};

export const BILLING_FREQUENCY: Record<BillingFrequency, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  semi_annual: "Every 6 months",
  annual: "Annually",
};

export const ID_TYPE: Record<TenantIdType, string> = {
  national_id: "National ID",
  passport: "Passport",
  alien_id: "Alien ID",
  company_registration: "Company registration",
  other: "Other",
};

export const DOCUMENT_CATEGORY: Record<DocumentCategory, string> = {
  photo: "Photo",
  lease_agreement: "Lease agreement",
  identity: "Identity document",
  inspection: "Inspection report",
  other: "Other",
};

export const RULE_SCOPE: Record<RuleScope, string> = {
  organization: "All properties",
  property: "One property",
  unit_type: "A unit type",
  unit: "One unit",
};

export const RULE_METHOD: Record<RuleMethod, string> = {
  fixed_monthly: "Fixed monthly",
  one_time: "One-time",
  metered: "Metered (per unit used)",
  shared: "Shared cost split",
};

export const INVOICE_KIND: Record<InvoiceKind, string> = {
  regular: "Regular",
  supplementary: "Supplementary",
  one_off: "One-off",
};

export const METER_UTILITY: Record<MeterUtility, string> = {
  water: "Water",
  electricity: "Electricity",
  gas: "Gas",
};

export const DEPOSIT_KIND: Record<DepositKind, string> = {
  received: "Received",
  deduction: "Deduction",
  refund: "Refund",
  reversal: "Reversal",
};

export const PAYMENT_METHOD: Record<Exclude<PaymentMethod, "">, string> = {
  mpesa: "M-Pesa",
  bank: "Bank transfer",
  cash: "Cash",
  cheque: "Cheque",
  other: "Other",
};

export const PAYMENT_PROVIDER: Record<PaymentProvider, string> = {
  mpesa_paybill: "M-Pesa Paybill",
  mpesa_till: "M-Pesa Till (Buy Goods)",
  bank: "Bank account",
  cash: "Cash",
  other: "Other",
};

export const PAYMENT_SOURCE: Record<PaymentSource, string> = {
  manual: "Recorded manually",
  mpesa_c2b: "M-Pesa paybill/till",
  mpesa_stk: "M-Pesa request",
  bank_import: "Bank statement",
};

export const INTEGRATION_STATUS: Record<
  IntegrationStatus,
  { label: string; variant: "muted" | "warning" | "accent" | "destructive" }
> = {
  not_configured: { label: "Not connected", variant: "muted" },
  credentials_saved: { label: "Not verified", variant: "warning" },
  verified: { label: "Connected", variant: "accent" },
  failed: { label: "Connection failed", variant: "destructive" },
};

export const MAINTENANCE_STATUS: Record<MaintenanceStatus, { label: string; variant: "warning" | "default" | "accent" | "muted" | "destructive" }> = {
  submitted: { label: "New", variant: "warning" },
  acknowledged: { label: "Acknowledged", variant: "default" },
  in_progress: { label: "In progress", variant: "default" },
  on_hold: { label: "On hold", variant: "muted" },
  resolved: { label: "Resolved", variant: "accent" },
  closed: { label: "Closed", variant: "muted" },
  cancelled: { label: "Cancelled", variant: "muted" },
};

/** Allowed next statuses (mirrors MaintenanceRequest.TRANSITIONS). */
export const MAINTENANCE_NEXT: Record<MaintenanceStatus, MaintenanceStatus[]> = {
  submitted: ["acknowledged", "in_progress", "cancelled"],
  acknowledged: ["in_progress", "on_hold", "resolved", "cancelled"],
  in_progress: ["on_hold", "resolved"],
  on_hold: ["in_progress", "resolved", "cancelled"],
  resolved: ["closed", "in_progress"],
  closed: [],
  cancelled: [],
};

export const MAINTENANCE_CATEGORY: Record<MaintenanceCategory, string> = {
  plumbing: "Plumbing",
  electrical: "Electrical",
  structural: "Structural",
  security: "Security / locks",
  appliance: "Appliance",
  pest: "Pest control",
  cleaning: "Cleaning",
  other: "Other",
};

export const URGENCY: Record<Urgency, { label: string; variant: "muted" | "default" | "warning" | "destructive" }> = {
  low: { label: "Low", variant: "muted" },
  normal: { label: "Normal", variant: "default" },
  high: { label: "High", variant: "warning" },
  emergency: { label: "Emergency", variant: "destructive" },
};

export const INSPECTION_KIND: Record<InspectionKind, string> = {
  move_in: "Move-in",
  move_out: "Move-out",
  routine: "Routine",
};

export const INSPECTION_STATUS: Record<Inspection["status"], { label: string; variant: "default" | "accent" | "muted" }> = {
  scheduled: { label: "Scheduled", variant: "default" },
  completed: { label: "Completed", variant: "accent" },
  cancelled: { label: "Cancelled", variant: "muted" },
};

export const ITEM_CONDITION: Record<ItemCondition, string> = {
  not_checked: "Not checked",
  good: "Good",
  fair: "Fair",
  poor: "Poor",
  damaged: "Damaged",
  missing: "Missing",
};

export const MOVE_OUT_STATUS: Record<MoveOutStatus, { label: string; variant: "warning" | "default" | "accent" | "muted" }> = {
  submitted: { label: "New notice", variant: "warning" },
  acknowledged: { label: "Acknowledged", variant: "default" },
  inspection_scheduled: { label: "Inspection scheduled", variant: "default" },
  completed: { label: "Moved out", variant: "accent" },
  withdrawn: { label: "Withdrawn", variant: "muted" },
};

export const ENQUIRY_STATUS: Record<EnquiryStatus, { label: string; variant: "warning" | "default" | "accent" | "muted" }> = {
  new: { label: "New", variant: "warning" },
  contacted: { label: "Contacted", variant: "default" },
  viewing_booked: { label: "Viewing booked", variant: "accent" },
  closed: { label: "Closed", variant: "muted" },
};

export const ENQUIRY_OUTCOME: Record<Exclude<EnquiryOutcome, "">, string> = {
  let: "Took the unit",
  not_interested: "Not interested",
  no_response: "No response",
  other: "Other",
};

export const TIME_OF_DAY: Record<TimeOfDay, string> = {
  any: "Any time",
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
};

export const EXPENSE_CATEGORY: Record<ExpenseCategory, string> = {
  utilities: "Utilities (water, power, internet)",
  security: "Security",
  cleaning: "Cleaning and garbage",
  salaries: "Salaries and wages",
  repairs: "Repairs and upkeep",
  insurance: "Insurance",
  rates: "Land rates and taxes",
  management: "Management and agent fees",
  professional: "Legal and professional fees",
  bank: "Bank and M-Pesa charges",
  advertising: "Advertising",
  office: "Office and administration",
  other: "Other",
};
