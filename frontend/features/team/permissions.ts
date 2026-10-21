import type { CapabilityCatalog, Role } from "@/types/api";

/** Effective capabilities for a role plus overrides (mirrors Membership.capabilities). */
export function effectiveCapabilities(
  catalog: CapabilityCatalog,
  role: Role,
  extra: string[],
  revoked: string[],
): Set<string> {
  if (role === "owner") return new Set(catalog.capabilities.map((c) => c.key));
  const defaults = catalog.roles.find((r) => r.key === role)?.default_capabilities ?? [];
  const granted = new Set([...defaults, ...extra]);
  for (const key of revoked) granted.delete(key);
  return granted;
}

/** Turn a desired capability set into the minimal extra/revoked overrides for a role. */
export function overridesFor(
  catalog: CapabilityCatalog,
  role: Role,
  desired: Set<string>,
): { extra_permissions: string[]; revoked_permissions: string[] } {
  if (role === "owner") return { extra_permissions: [], revoked_permissions: [] };
  const defaults = new Set(catalog.roles.find((r) => r.key === role)?.default_capabilities ?? []);
  return {
    extra_permissions: [...desired].filter((k) => !defaults.has(k)).sort(),
    revoked_permissions: [...defaults].filter((k) => !desired.has(k)).sort(),
  };
}
