import { useQueryClient } from "@tanstack/react-query";

import { useOrganization } from "@/components/providers/organization-provider";

/** Organization-scoped query key: switching organizations never reuses cached data. */
export function useOrgKey() {
  const { organizationId } = useOrganization();
  return (...parts: unknown[]) => ["org", organizationId, ...parts] as const;
}

/** Invalidate one or more organization-scoped resources after a mutation. */
export function useInvalidateOrg() {
  const qc = useQueryClient();
  const { organizationId } = useOrganization();
  return (...resources: string[]) =>
    Promise.all(
      resources.map((r) => qc.invalidateQueries({ queryKey: ["org", organizationId, r] })),
    );
}
