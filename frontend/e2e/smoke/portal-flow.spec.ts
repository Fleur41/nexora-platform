import { devices } from "@playwright/test";

import { Api } from "../support/api";
import { month, today } from "../support/data";
import { expect, test } from "../support/fixtures";
import { linkFromEmail } from "../support/mailbox";

// The tenant app is used on phones: run at Pixel 7 size with touch.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- browser type is set per project
const { defaultBrowserType, ...phone } = devices["Pixel 7"];
test.use(phone);

const unique = Date.now().toString(36);
// A 1×1 PNG, enough for an image upload.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

test("tenant joins from the email invitation, sees bills, pays, reports a repair and gives notice", async ({ app, browser, baseURL }) => {
  const tenant = { name: "Achieng Otieno", email: `e2e-tenant-${unique}@example.com`, password: "Nexora-tenant-2026" };

  // --- Staff, in their own browser session: a let unit with two bills and a payment ------------------
  const staffContext = await browser.newContext({ baseURL });
  const staffPage = await staffContext.newPage();
  const staff = new Api(staffPage);
  await staff.signUpOwner("Portal Owner", `e2e-portal-owner-${unique}@example.com`, "Nexora-e2e-pass-2026", `Portal Homes ${unique}`);
  const { unitIds } = await staff.propertyWithUnits("Kileleshwa Court", "18000", "18000", "K", 2);
  const tenantRecord = await staff.post<{ id: string }>("/tenants/", { full_name: tenant.name, phone: "0712 345 678", email: tenant.email });
  const lease = await staff.post<{ id: string; reference: string }>("/leases/", {
    tenant: tenantRecord.id, unit: unitIds[0], start_date: `${month(-1)}-01`, monthly_rent: "18000", deposit_amount: "18000", activate: true,
  });
  await staff.post("/billing-runs/", { period: month(-1) });
  await staff.post("/billing-runs/", { period: month(0) });
  await staff.post("/payment-configurations/", { provider: "mpesa_paybill", display_name: "Rent paybill", shortcode: "600987" });
  await staff.post("/payments/", {
    lease: lease.id, amount: "20000", received_on: today, method: "mpesa", reference: `QK${unique.toUpperCase().slice(0, 8)}`, payer_name: "", payer_phone: "", notes: "",
  });

  // Staff invites the tenant from the tenant page.
  await staffPage.goto(`/dashboard/tenants/${tenantRecord.id}`);
  await expect(staffPage.getByText("Not invited", { exact: true })).toBeVisible();
  await staffPage.getByRole("button", { name: "Send invitation" }).click();
  await expect(staffPage.getByText("Invited", { exact: true })).toBeVisible();

  // --- Tenant, on their phone ------------------------------------------------------------
  const link = await linkFromEmail(tenant.email, /https?:\/\/\S+\/portal\/join\/\S+/);
  await app.portal.joinFromInvitation(link, tenant);

  // Home: 2 × 18,000 billed − 20,000 paid = 16,000, the oldest bill overdue.
  await app.portal.expectBalance("16,000");
  await expect(app.portal.text(/is overdue/)).toBeVisible();
  await expect(app.portal.text("Kileleshwa Court · Unit K1")).toBeVisible();
  await app.portal.snap("portal-home");

  // Bills, a bill's lines, and the receipt.
  await app.portal.openTab("Bills");
  await expect(app.portal.link(/INV-\d+/)).toHaveCount(2);
  // Payments clear the oldest bill first, so the current month's bill is the unpaid one.
  await app.portal.link(/to pay/).click();
  await expect(app.portal.text("Still to pay")).toBeVisible();
  await expect(app.portal.link(/^Pay /)).toBeVisible();
  await app.portal.openReceipt("RCT-00001");
  await expect(app.portal.text("Achieng Otieno")).toBeVisible();
  await expect(app.portal.text(/20,000/).first()).toBeVisible();

  // How to pay: paybill and the lease's account number.
  await app.portal.openTab("Pay");
  await expect(app.portal.text("600987", true)).toBeVisible();
  await expect(app.portal.text(lease.reference.replace("-", ""), true)).toBeVisible();
  await app.portal.snap("portal-pay");

  // Repair with a photo; staff reply and an internal note.
  await app.portal.reportRepair({
    category: "Electrical", urgency: "High", title: "Bedroom socket sparks",
    details: "The socket by the bed sparks when anything is plugged in.", photo: { name: "socket.png", buffer: PNG },
  });
  await expect(app.portal.page.getByRole("img", { name: "socket.png" })).toBeVisible();
  const requestId = app.portal.page.url().split("/").pop()!;
  await staff.post(`/maintenance/${requestId}/status/`, { status: "acknowledged", note: "An electrician will come tomorrow at 10am." });
  await staff.post(`/maintenance/${requestId}/notes/`, { body: "Check the whole circuit; tenant had complaints before.", internal: true });
  await app.portal.page.reload();
  await expect(app.portal.text("An electrician will come tomorrow at 10am.")).toBeVisible();
  await expect(app.portal.text("Seen by your landlord").first()).toBeVisible();
  await expect(app.portal.text(/whole circuit/)).toHaveCount(0); // internal notes never reach tenants
  await app.portal.messageLandlord("Thanks, someone will be home.");
  await app.portal.snap("portal-repair");

  // The bell has the landlord's update.
  await app.portal.page.getByRole("button", { name: /^Notifications \(\d+ unread\)/ }).click();
  await expect(app.portal.page.getByRole("menuitem", { name: /Bedroom socket sparks/ }).first()).toBeVisible();
  await app.portal.page.keyboard.press("Escape");

  // Notice to move out, seen by staff, then withdrawn while still unacknowledged.
  await app.portal.giveNotice(today, "Moving closer to work.");
  const notices = await staff.get<{ results: { from_tenant: boolean; status: string }[] }>(`/move-outs/?lease=${lease.id}`);
  expect(notices.results[0]).toMatchObject({ from_tenant: true, status: "submitted" });
  await app.portal.button("Withdraw notice").click();
  await app.portal.confirmDialog.getByRole("button", { name: "Withdraw notice" }).click();
  await app.portal.expectToast("Notice withdrawn");
  await expect(app.portal.text("Send notice", true)).toBeVisible();

  // A tenant-only account lands in the portal, not staff onboarding.
  await app.portal.page.goto("/dashboard");
  await app.portal.page.waitForURL((url) => url.pathname === "/portal");

  await staffContext.close();
});
