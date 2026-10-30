import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { PlatformPage } from "../pages";
import { Api } from "../support/api";
import { month } from "../support/data";
import { expect, test } from "../support/fixtures";

const unique = Date.now().toString(36);

/** WCAG 2.1 A and AA rules that axe can check automatically. See docs/accessibility.md. */
async function expectNoViolations(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const summary = violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`);
  expect(summary, `accessibility violations on ${path}`).toEqual([]);
}

test("public pages, the dashboard and the platform console meet WCAG 2.1 AA (automated checks)", async ({ page, browser, baseURL }) => {
  for (const path of ["/", "/login", "/register", "/listings"]) await expectNoViolations(page, path);

  const api = new Api(page);
  await api.signUpOwner("Access Owner", `e2e-a11y-${unique}@example.com`, "Nexora-e2e-pass-2026", `Access Homes ${unique}`);
  const { propertyId, unitIds } = await api.propertyWithUnits("Kilimani Court", "18000", "18000", "K", 3);
  const tenant = await api.post<{ id: string }>("/tenants/", { full_name: "Wanjiru Njoroge", phone: "0711 222 333" });
  await api.post("/leases/", { tenant: tenant.id, unit: unitIds[0], start_date: `${month(0)}-01`, monthly_rent: "18000", deposit_amount: "0", activate: true });
  await api.post("/billing-runs/", { period: month(0) });

  for (const path of [
    "/dashboard",
    "/dashboard/properties",
    `/dashboard/properties/${propertyId}`,
    `/dashboard/tenants/${tenant.id}`,
    "/dashboard/leases",
    "/dashboard/billing",
    "/dashboard/payments",
    "/dashboard/reports",
    "/dashboard/settings/subscription",
  ]) {
    await expectNoViolations(page, path);
  }

  // Keyboard: the first Tab reaches "Skip to main content", which moves focus past the sidebar.
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to main content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("main#main")).toBeFocused();

  const context = await browser.newContext({ baseURL });
  const platform = new PlatformPage(await context.newPage());
  await platform.signIn(process.env.E2E_PLATFORM_EMAIL ?? "e2e-platform@example.com", process.env.E2E_PLATFORM_PASSWORD ?? "Nexora-e2e-pass-2026");
  for (const path of ["/platform", "/platform/invoices", "/platform/plans"]) await expectNoViolations(platform.page, path);
  await context.close();
});
