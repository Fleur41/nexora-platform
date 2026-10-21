import { describe, expect, it } from "vitest";

import { safeNextPath } from "@/lib/navigation";

describe("safeNextPath", () => {
  it.each([
    ["/dashboard/team", "/dashboard/team"],
    ["/invitations/abc?x=1", "/invitations/abc?x=1"],
  ])("accepts relative path %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "", null])(
    "rejects unsafe redirect %s",
    (input) => {
      expect(safeNextPath(input)).toBe("/dashboard");
    },
  );
});
