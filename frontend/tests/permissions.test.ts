import { describe, expect, it } from "vitest";

import { effectiveCapabilities, overridesFor } from "@/features/team/permissions";
import type { CapabilityCatalog } from "@/types/api";

const catalog: CapabilityCatalog = {
  access_scopes: [],
  capabilities: [
    { key: "organization.manage", label: "", module: "platform" },
    { key: "members.view", label: "", module: "platform" },
    { key: "members.manage", label: "", module: "platform" },
    { key: "audit.view", label: "", module: "platform" },
  ],
  roles: [
    { key: "owner", label: "", default_access_scope: "organization", default_capabilities: [] },
    { key: "property_manager", label: "", default_access_scope: "assigned", default_capabilities: ["members.view"] },
    { key: "accountant", label: "", default_access_scope: "organization", default_capabilities: ["audit.view"] },
    { key: "caretaker", label: "", default_access_scope: "assigned", default_capabilities: [] },
  ],
};

describe("capability overrides", () => {
  it("owners always have everything", () => {
    expect(effectiveCapabilities(catalog, "owner", [], ["members.view"]).size).toBe(4);
  });

  it("applies extra and revoked permissions on top of role defaults", () => {
    const caps = effectiveCapabilities(catalog, "property_manager", ["audit.view"], ["members.view"]);
    expect([...caps]).toEqual(["audit.view"]);
  });

  it("computes the minimal overrides for a desired set", () => {
    const desired = new Set(["audit.view"]);
    expect(overridesFor(catalog, "property_manager", desired)).toEqual({
      extra_permissions: ["audit.view"],
      revoked_permissions: ["members.view"],
    });
    expect(overridesFor(catalog, "accountant", new Set(["audit.view"]))).toEqual({
      extra_permissions: [],
      revoked_permissions: [],
    });
  });
});
