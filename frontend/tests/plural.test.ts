import { expect, it } from "vitest";

import { formatMonth, plural } from "@/lib/utils";

it("pluralizes counts", () => {
  expect(plural(1, "open invoice")).toBe("1 open invoice");
  expect(plural(0, "invoice")).toBe("0 invoices");
  expect(plural(3, "property", "properties")).toBe("3 properties");
});

it("formats billing months", () => {
  expect(formatMonth("2026-08-01")).toBe("Aug 2026");
  expect(formatMonth("2026-12")).toBe("Dec 2026");
  expect(formatMonth(null)).toBe("—");
});
