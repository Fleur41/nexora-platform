import { Api } from "../support/api";
import { expect, test } from "../support/fixtures";
import { BasePage, PlatformPage } from "../pages";

const unique = Date.now().toString(36);
// Granted in CI (and locally) with: manage.py platform_admin e2e-platform@example.com --create
const staff = {
  email: process.env.E2E_PLATFORM_EMAIL ?? "e2e-platform@example.com",
  password: process.env.E2E_PLATFORM_PASSWORD ?? "Nexora-e2e-pass-2026",
};

test("owner sees their trial and changes plan; Nexora bills them, records payment and opens a support session", async ({ page, browser, baseURL }) => {
  // --- The owner: a new organization starts on a free trial ---------------------------------
  const api = new Api(page);
  const owner = new BasePage(page);
  const orgName = `Saas Homes ${unique}`;
  await api.signUpOwner("Saas Owner", `e2e-saas-${unique}@example.com`, "Nexora-e2e-pass-2026", orgName);
  await page.goto("/dashboard");
  await owner.openFromSidebar("Subscription");
  await expect(owner.text(/^Growth plan/)).toBeVisible();
  await expect(owner.text("Free trial", true).first()).toBeVisible();
  await expect(owner.text("0 of 100")).toBeVisible();
  await owner.button("Switch to Pro").click();
  await owner.confirmDialog.getByRole("button", { name: "Switch plan" }).click();
  await expect(owner.text("You're on the Pro plan")).toBeVisible();
  await expect(owner.text(/^Pro plan/)).toBeVisible();
  await owner.snap("subscription");

  // --- Nexora staff, in their own browser -----------------------------------------------------
  const context = await browser.newContext({ baseURL });
  const platform = new PlatformPage(await context.newPage());
  await platform.signIn(staff.email, staff.password);
  await platform.openOrganization(orgName);
  await expect(platform.text("Saas Owner · ", false).first()).toBeVisible();
  const invoice = await platform.issueInvoice();
  await platform.recordPayment(invoice, "Bank transfer", `FT${unique}`.toUpperCase());
  await platform.snap("platform-organization");

  // The owner sees the paid invoice and an active subscription.
  await page.reload();
  await expect(owner.text("Active", true).first()).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(invoice) }).filter({ visible: true })).toContainText("Paid");

  // --- Support: read-only, time-limited, announced --------------------------------------------
  await platform.startSupport(`Ticket ${unique}: owner asked for help`);
  await platform.button("Open their dashboard").click();
  await platform.page.waitForURL(/\/dashboard$/);
  await expect(platform.text(/as Nexora support\. Read-only/)).toBeVisible();
  await platform.snap("support-session");
  await expect(platform.page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Properties", exact: true })).toBeVisible();
  // Owner-only settings aren't part of a support view.
  await expect(platform.page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Subscription", exact: true })).toHaveCount(0);
  await platform.link("Back to the platform console").click();
  await platform.openOrganization(orgName);
  await platform.button("End session").click();
  await expect(platform.button("Start support session")).toBeVisible();
  await context.close();

  // The owners were told, with the reason.
  await page.goto("/dashboard");
  await page.getByRole("button", { name: /^Notifications/ }).click();
  await expect(page.getByRole("menu").getByText("Nexora support is viewing your account")).toBeVisible();
  await expect(page.getByRole("menu").getByText(new RegExp(`Ticket ${unique}`))).toBeVisible();
});
