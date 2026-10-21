import { describe, expect, it } from "vitest";

import { formatBytes, formatDay, formatMoney, todayIn } from "@/lib/utils";

describe("formatMoney", () => {
  it("formats KES decimal strings without float drift", () => {
    expect(formatMoney("25000.00")).toMatch(/25,000$/);
    expect(formatMoney("18999.99")).toMatch(/18,999\.99$/);
    expect(formatMoney("0.10")).toMatch(/0\.10$/);
  });

  it("shows a dash for missing values", () => {
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney("")).toBe("—");
    expect(formatMoney("abc")).toBe("—");
  });
});

describe("dates", () => {
  it("formats calendar days without shifting across timezones", () => {
    expect(formatDay("2026-01-01")).toMatch(/1 Jan 2026/);
    expect(formatDay(null)).toBe("—");
  });

  it("computes today in a given timezone as YYYY-MM-DD", () => {
    expect(todayIn("Africa/Nairobi")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

it("formats file sizes", () => {
  expect(formatBytes(512)).toBe("512 B");
  expect(formatBytes(2048)).toBe("2 KB");
  expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
});
