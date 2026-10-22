import {
  Building2,
  DoorOpen,
  FileText,
  Gauge,
  Home,
  Receipt,
  Tags,
  LayoutDashboard,
  UserCog,
  ScrollText,
  Settings,
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

// Only modules that are actually implemented appear here. Payments, maintenance and other
// modules are added as their phases ship.
export const DASHBOARD_NAV: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/properties", label: "Properties", icon: Home, capability: "properties.view" },
  { href: "/dashboard/units", label: "Units", icon: DoorOpen, capability: "properties.view" },
  { href: "/dashboard/tenants", label: "Tenants", icon: Users, capability: "tenants.view" },
  { href: "/dashboard/leases", label: "Leases", icon: FileText, capability: "leases.view" },
  { href: "/dashboard/billing", label: "Billing", icon: Receipt, capability: "billing.view" },
  { href: "/dashboard/utilities", label: "Utilities", icon: Gauge, capability: "meters.view" },
  { href: "/dashboard/charges", label: "Charges", icon: Tags, capability: "billing.view" },
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
