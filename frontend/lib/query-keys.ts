// Organization-scoped keys include the organization id so switching organizations
// never shows cached data from another organization.
export const queryKeys = {
  me: ["auth", "me"] as const,
  myOrganizations: ["organizations", "mine"] as const,
  currentOrganization: (orgId: string) => ["org", orgId, "current"] as const,
  members: (orgId: string, params: object) => ["org", orgId, "members", params] as const,
  invitations: (orgId: string, params: object) => ["org", orgId, "invitations", params] as const,
  auditLogs: (orgId: string, params: object) => ["org", orgId, "audit-logs", params] as const,
  capabilityCatalog: ["permissions", "catalog"] as const,
  invitationPreview: (token: string) => ["invitations", "preview", token] as const,
};
