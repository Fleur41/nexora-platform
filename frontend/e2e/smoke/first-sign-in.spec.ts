import { expect, test } from "@playwright/test";

import { sameOrigin } from "../support/api";

// Regression: on a fresh browser (no remembered organization) the dashboard's first requests
// went out without X-Organization-ID, so every widget showed an error or zeros.
test("first sign-in on a new browser loads organization data", async ({ page }) => {
  const unique = Date.now().toString(36);
  const email = `e2e-first-${unique}@example.com`;
  await page.goto("/login");
  const csrf = async () => (await page.context().cookies()).find((c) => c.name === "nexora_csrftoken")?.value ?? "";
  await page.request.get("/api/v1/auth/csrf/");
  await page.request.post("/api/v1/auth/register/", {
    data: { full_name: "First Login", email, password: "Nexora-e2e-pass-2026" },
    headers: { ...sameOrigin(page), "X-CSRFToken": await csrf() },
  });
  await page.request.post("/api/v1/organizations/", {
    data: { name: `Fresh Org ${unique}` },
    headers: { ...sameOrigin(page), "X-CSRFToken": await csrf() },
  });
  await page.request.post("/api/v1/auth/logout/", { headers: { ...sameOrigin(page), "X-CSRFToken": await csrf() } });
  await page.evaluate(() => localStorage.clear());

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("Nexora-e2e-pass-2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  const team = page.locator("a", { hasText: "Active team members" }).filter({ visible: true });
  await expect(team).toContainText("1");
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Could not load this data").filter({ visible: true })).toHaveCount(0);
});
