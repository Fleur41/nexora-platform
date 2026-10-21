import type { Role } from "@/types/api";

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  property_manager: "Property manager",
  accountant: "Accountant / cashier",
  caretaker: "Caretaker / maintenance",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: "Full control of the organization, team, settings and finances.",
  property_manager: "Runs day-to-day operations for assigned properties.",
  accountant: "Records and reconciles payments; views permitted financial records.",
  caretaker: "Handles assigned properties and maintenance work orders.",
};

export const ASSIGNABLE_ROLES: Role[] = ["owner", "property_manager", "accountant", "caretaker"];
