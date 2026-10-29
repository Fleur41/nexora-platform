import {
  Building2,
  ClipboardCheck,
  LogOut,
  Megaphone,
  DoorOpen,
  FileText,
  Banknote,
  BarChart3,
  CreditCard,
  Gauge,
  Home,
  Receipt,
  Tags,
  Wrench,
  LayoutDashboard,
  UserCog,
  ScrollText,
  Settings,
  Signpost,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Hide the link when the member lacks this capability (the API enforces it regardless). */
  capability?: string;
}

// Only modules that are actually implemented appear here; others are added as their phases ship.
export const DASHBOARD_NAV: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/properties", label: "Properties", icon: Home, capability: "properties.view" },
  { href: "/dashboard/units", label: "Units", icon: DoorOpen, capability: "properties.view" },
  { href: "/dashboard/tenants", label: "Tenants", icon: Users, capability: "tenants.view" },
  { href: "/dashboard/leases", label: "Leases", icon: FileText, capability: "leases.view" },
  { href: "/dashboard/maintenance", label: "Maintenance", icon: Wrench, capability: "maintenance.view" },
  { href: "/dashboard/inspections", label: "Inspections", icon: ClipboardCheck, capability: "inspections.view" },
  { href: "/dashboard/move-outs", label: "Move-outs", icon: LogOut, capability: "moveouts.view" },
  { href: "/dashboard/listings", label: "Listings", icon: Signpost, capability: "listings.view" },
  { href: "/dashboard/communications", label: "Communications", icon: Megaphone, capability: "announcements.send" },
  { href: "/dashboard/billing", label: "Billing", icon: Receipt, capability: "billing.view" },
  { href: "/dashboard/payments", label: "Payments", icon: Banknote, capability: "payments.view" },
  { href: "/dashboard/reports", label: "Reports", icon: BarChart3, capability: "reports.view" },
  { href: "/dashboard/utilities", label: "Utilities", icon: Gauge, capability: "meters.view" },
  { href: "/dashboard/charges", label: "Charges", icon: Tags, capability: "billing.view" },
  {
    href: "/dashboard/settings/payments",
    label: "Payment settings",
    icon: CreditCard,
    capability: "payments.view",
  },
  { href: "/dashboard/team", label: "Team", icon: UserCog, capability: "members.view" },
  { href: "/dashboard/audit", label: "Audit log", icon: ScrollText, capability: "audit.view" },
  {
    href: "/dashboard/settings",
    label: "Organization",
    icon: Building2,
    capability: "organization.manage",
  },
  { href: "/dashboard/account", label: "My account", icon: Settings },
];

/** Accept only same-site relative paths as post-login redirects (no open redirects). */
export function safeNextPath(value: string | null | undefined, fallback = "/dashboard"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return fallback;
  }
  return value;
}
