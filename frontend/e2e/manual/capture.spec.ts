import fs from "node:fs";
import path from "node:path";

import type { Locator, Page } from "@playwright/test";

import { BasePage } from "../pages";
import { month, today } from "../support/data";
import { expect, test } from "../support/fixtures";
import { linkFromEmail } from "../support/mailbox";

/**
 * Captures the screenshots for the user manual (docs/manual). Not a test suite: it walks the
 * manual's steps as a landlord and a tenant (phone) and saves a picture of each step, with the
 * button to press outlined. Build the PDF afterwards with `npm run docs:manual`.
 */

const SCREENS = path.resolve(process.env.MANUAL_SCREENS ?? "../docs/manual/screens");
const MAILPIT = (process.env.MAILPIT_URL ?? "http://localhost:8025").replace(/\/$/, "");
const unique = Date.now().toString(36);
const landlord = { name: "Grace Wanjiru", email: `landlord-${unique}@example.com`, password: "Nexora-demo-2026" };
const tenant = { name: "Wanjiku Kamau", email: `wanjiku-${unique}@example.com`, password: "Nexora-tenant-2026" };
const day = Number(today.slice(8, 10));
const midMonth = `${month(0)}-${String(day > 1 ? day : 15).padStart(2, "0")}`;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

/** How each picture should be laid out in the PDF: a cropped dialog/card, a full screen, or a phone. */
const kinds: Record<string, "crop" | "screen" | "tall" | "phone"> = {};

/** Save a screenshot, optionally outlining the element to click and cropping to an element. */
async function shot(page: Page, name: string, opts: { highlight?: Locator; target?: Locator; fullPage?: boolean } = {}) {
  const viewport = page.viewportSize();
  const isPhone = (viewport?.width ?? 1280) < 600;
  // Tall dialogs are clipped by the window: make it tall enough while capturing them.
  if (opts.target && !isPhone) await page.setViewportSize({ width: viewport!.width, height: 1400 });
  await page.waitForTimeout(350); // let dialogs finish animating
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur(); // no focus rings competing with the outline
    // Toasts are transient: keep them out of the pictures (only while capturing, so the
    // walkthrough can still check them).
    const style = document.createElement("style");
    style.id = "manual-hide-toasts";
    style.textContent = "[data-sonner-toaster] { display: none !important; }";
    document.head.appendChild(style);
  });
  if (opts.fullPage) {
    // Sticky headers and the phone's fixed tab bar would be drawn mid-page in a full-page
    // capture: lay them out in place (header at the top, tab bar at the bottom).
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      const style = document.createElement("style");
      style.id = "manual-static-header";
      style.textContent =
        'header, nav[aria-label="Portal tabs"] { position: static !important; } aside { position: static !important; height: auto !important; }';
      document.head.appendChild(style);
    });
  }
  if (opts.highlight) {
    // Make sure what we point at is in the picture.
    if (!opts.target && !opts.fullPage) {
      await opts.highlight.first().evaluate((el: HTMLElement) => el.scrollIntoView({ block: "center" }));
    }
    await opts.highlight.first().evaluate((el: HTMLElement) => {
      el.style.outline = "3px solid #e11d48";
      el.style.outlineOffset = "3px";
      el.style.boxShadow = "0 0 0 9px rgba(225, 29, 72, 0.22)";
    });
  }
  const file = path.join(SCREENS, `${name}.jpg`);
  if (opts.target) await opts.target.first().screenshot({ path: file, type: "jpeg", quality: 82 });
  else await page.screenshot({ path: file, type: "jpeg", quality: 82, fullPage: opts.fullPage });
  kinds[name] = isPhone ? "phone" : opts.target ? "crop" : opts.fullPage ? "tall" : "screen";
  if (opts.highlight) {
    await opts.highlight.first().evaluate((el: HTMLElement) => {
      el.style.outline = "";
      el.style.boxShadow = "";
    });
  }
  await page.evaluate(() => {
    document.getElementById("manual-hide-toasts")?.remove();
    document.getElementById("manual-static-header")?.remove();
  });
  if (opts.target && !isPhone) await page.setViewportSize(viewport!);
}

test.beforeAll(() => fs.mkdirSync(SCREENS, { recursive: true }));
test.afterAll(() => fs.writeFileSync(path.join(SCREENS, "manifest.json"), JSON.stringify(kinds, null, 2)));

test("capture the manual's screenshots", async ({ app, tenantApp, page }) => {
  const ui = new BasePage(page);
  const phone = tenantApp.page;
  const t = new BasePage(phone);
  const dialog = page.getByRole("dialog");
  let leaseUrl = "";

  // --- 1. Sign up -----------------------------------------------------------------------
  await page.goto("/register");
  await ui.field("Full name").fill(landlord.name);
  await ui.field("Work email").fill(landlord.email);
  await ui.field("Password").fill(landlord.password);
  await shot(page, "01-register", { highlight: ui.button("Create account") });
  await ui.button("Create account").click();
  await page.waitForURL(/\/onboarding/);
  await ui.field("Organization name").fill("Riverside Lettings");
  await shot(page, "02-organization", { highlight: ui.button("Create organization") });
  await ui.button("Create organization").click();
  await expect(ui.heading("Riverside Lettings")).toBeVisible();
  await shot(page, "03-dashboard");

  // --- 2. Property and units --------------------------------------------------------------
  await ui.openFromSidebar("Properties");
  await ui.button("Add property").first().click();
  await ui.field("Name", true).fill("Riverside Apartments");
  await ui.field("Town / area").fill("Westlands");
  await ui.field("County").fill("Nairobi");
  await shot(page, "04-add-property", { target: dialog, highlight: ui.button("Create property") });
  await ui.button("Create property").click();
  await expect(ui.heading("Riverside Apartments")).toBeVisible();
  await page.getByRole("tab", { name: "Unit types" }).click();
  await ui.button("Add unit type").click();
  await ui.field("Category").selectOption("one_bedroom");
  await ui.field("Default monthly rent").fill("22000");
  await ui.field("Default deposit").fill("22000");
  await shot(page, "05-unit-type", { target: dialog, highlight: ui.button("Save") });
  await ui.button("Save").click();
  await expect(dialog).toBeHidden();
  await page.getByRole("tab", { name: "Units" }).click();
  await ui.button("Add several").click();
  await ui.field("Prefix").fill("R");
  await ui.field("How many").fill("4");
  await expect(dialog.getByText("R1")).toBeVisible();
  await shot(page, "06-add-units", { target: dialog, highlight: ui.button("Create units") });
  await ui.button("Create units").click();
  await expect(app.properties.unitTile("R4", "Available")).toBeVisible();
  await shot(page, "07-units");

  // --- 3. Tenant and lease ------------------------------------------------------------------
  await ui.openFromSidebar("Tenants");
  await ui.button("Register tenant").first().click();
  await ui.field("Full name").fill(tenant.name);
  await ui.field("Phone", true).fill("0722 456 789");
  await ui.field("Email (optional)").fill(tenant.email);
  await ui.field("ID number").fill(`3${unique.slice(-7)}`);
  await shot(page, "08-register-tenant", { target: dialog, highlight: ui.button("Register tenant").last() });
  await ui.button("Register tenant").last().click();
  await expect(ui.heading(tenant.name)).toBeVisible();
  await ui.link("New lease").click();
  const propertySelect = ui.field("Property");
  await propertySelect.selectOption({ label: (await propertySelect.locator("option", { hasText: "Riverside Apartments" }).textContent())! });
  await ui.field("Unit", true).selectOption({ index: 1 });
  await expect(ui.field(/Monthly rent/)).toHaveValue("22000.00");
  // The mid-month option only appears for a start date after the 1st: picture it, then
  // continue with the walkthrough's start on the 1st.
  await ui.field("Start date", true).fill(midMonth);
  const option = page.locator("label", { hasText: "Charge the first month in full" });
  await option.scrollIntoViewIfNeeded();
  await shot(page, "09b-first-month-option", { highlight: option });
  await ui.field("Start date", true).fill(`${month(-1)}-01`);
  await expect(option).toHaveCount(0);
  await shot(page, "09-new-lease", { fullPage: true, highlight: ui.button("Create lease") });
  await ui.button("Create lease").click();
  await expect(ui.heading(/^LSE-\d+$/)).toBeVisible();
  leaseUrl = page.url();
  await shot(page, "10-lease-active");

  // --- 4. The tenant joins the tenant app -------------------------------------------------
  await app.tenants.open(tenant.name);
  await expect(ui.text("Not invited", true)).toBeVisible();
  await shot(page, "11-invite", { highlight: ui.button("Send invitation") });
  await ui.button("Send invitation").click();
  await expect(ui.text("Invited", true)).toBeVisible();
  const link = await linkFromEmail(tenant.email, /https?:\/\/\S+\/portal\/join\/\S+/);
  const search = (await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${tenant.email}"`)}&limit=1`)).json()) as { messages: { ID: string }[] };
  const mail = await page.context().newPage();
  await mail.goto(`${MAILPIT}/view/${search.messages[0]!.ID}`);
  await expect(mail.getByText(/Your tenant account with/).first()).toBeVisible();
  await shot(mail, "12-invitation-email");
  await mail.close();

  await phone.goto(new URL(link).pathname);
  await expect(t.heading(/^Your home with/)).toBeVisible();
  await shot(phone, "13-tenant-invitation", { highlight: t.link("Create account") });
  await t.link("Create account").click();
  await t.field("Full name").fill(tenant.name);
  await t.field("Password").fill(tenant.password);
  await shot(phone, "14-tenant-signup", { highlight: t.button("Create account") });
  await t.button("Create account").click();
  await expect(t.heading(/^Your home with/)).toBeVisible();
  await t.button("Open my home").click();
  await phone.waitForURL((url) => url.pathname === "/portal");
  await expect(t.heading("Hi Wanjiku")).toBeVisible();
  await shot(phone, "15-tenant-home");
  await page.reload();
  await expect(ui.text("Using the app", true)).toBeVisible();
  await shot(page, "16-using-the-app", { highlight: ui.text("Using the app", true) });

  // --- 5. Payment method, charges and billing -------------------------------------------------
  await page.goto("/dashboard/settings/payments");
  await ui.button("Add payment method").first().click();
  await ui.field("Name", true).fill("Rent paybill");
  await ui.field("Paybill number").fill("600987");
  await shot(page, "17-paybill", { target: dialog, highlight: ui.button("Save", true) });
  await ui.button("Save", true).click();
  await expect(ui.text("600987")).toBeVisible();

  await ui.openFromSidebar("Charges");
  await ui.button("Add rule").first().click();
  await ui.field("Charge", true).selectOption({ label: "Security" });
  await ui.field(/^Amount/).fill("1500");
  await ui.field("Effective from").fill(`${month(-1)}-01`);
  await shot(page, "18-charge-rule", { target: dialog, highlight: ui.button("Save rule") });
  await ui.button("Save rule").click();
  await expect(page.getByRole("row", { name: /Security.*All properties/ })).toBeVisible();

  await ui.openFromSidebar("Billing");
  for (const [i, m] of [month(-1), month(0)].entries()) {
    await ui.button("Generate invoices").click();
    await ui.field("Month").fill(m);
    await ui.button("Preview").click();
    await expect(dialog.getByText(/invoices? totalling/)).toContainText("23,500");
    if (i === 0) await shot(page, "19-billing-preview", { target: dialog, highlight: ui.button("Post invoices") });
    await ui.button("Post invoices").click();
    await expect(dialog).toBeHidden();
  }
  await shot(page, "20-invoices");
  await phone.reload();
  await tenantApp.expectBalance("47,000");
  await shot(phone, "21-tenant-owes");
  await tenantApp.openTab("Bills");
  await shot(phone, "22-tenant-bills");

  // --- 6. Deposit and payment -------------------------------------------------------------
  await app.lease.open(leaseUrl);
  await ui.button("Record received").click();
  await ui.field(/^Amount/).fill("22000");
  await ui.field(/Reference/).fill("DEP-001");
  await shot(page, "23-deposit", { target: dialog, highlight: ui.button("Save", true) });
  await ui.button("Save", true).click();
  await expect(ui.text(/DEP-001/)).toBeVisible();
  await ui.button("Record payment").first().click();
  await ui.field(/^Amount/).fill("30000");
  await ui.field("Paid via").selectOption({ label: "Cash" });
  await shot(page, "24-payment", { target: dialog, highlight: dialog.getByRole("button", { name: "Record payment" }) });
  await dialog.getByRole("button", { name: "Record payment" }).click();
  await app.lease.expectBalance("17,000");
  await shot(page, "25-lease-after-payment");
  await app.payments.openReceipt("RCT-00001");
  await shot(page, "26-receipt");
  await tenantApp.openTab("Home");
  await tenantApp.expectBalance("17,000");
  await shot(phone, "27-tenant-after-payment");
  await tenantApp.openTab("Pay");
  await expect(t.text("600987", true)).toBeVisible();
  await shot(phone, "28-tenant-pay");

  // --- 7. Announcement ----------------------------------------------------------------------
  await app.communications.open();
  await ui.field("Title").fill("Water interruption on Saturday");
  await ui.field("Message").fill("Supply is off from 8am to 2pm for tank cleaning.");
  await shot(page, "29-announcement", { highlight: ui.button("Send", true) });
  await ui.button("Send", true).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Send now" }).click();
  await ui.expectToast("Sent to 1 tenant");
  await page.getByRole("tab", { name: "Delivery log" }).click();
  await expect(page.getByRole("row", { name: /Water interruption/ }).first()).toBeVisible();
  await shot(page, "30-delivery-log");
  await phone.reload();
  await phone.getByRole("button", { name: /^Notifications/ }).click();
  await expect(phone.getByRole("menuitem", { name: /Water interruption/ }).first()).toBeVisible();
  await shot(phone, "31-tenant-bell");
  await phone.keyboard.press("Escape");

  // --- 8. Repair ------------------------------------------------------------------------------
  const repair = "Kitchen sink leaking";
  await tenantApp.openTab("Repairs");
  await t.button("Report a repair").click();
  await t.field("What kind?").selectOption({ label: "Plumbing" });
  await t.field("How urgent?").selectOption({ label: "High" });
  await t.field("What's wrong?").fill(repair);
  await t.field("Details").fill("Water pooling under the sink since last night.");
  await phone.getByLabel("Add photos").setInputFiles({ name: "sink.png", mimeType: "image/png", buffer: PNG });
  await shot(phone, "32-tenant-report-repair", { fullPage: true, highlight: t.button("Send report") });
  await t.button("Send report").click();
  await expect(t.heading(repair)).toBeVisible();

  await app.maintenance.open(repair);
  await app.maintenance.moveTo("Acknowledge", "Acknowledged");
  await app.maintenance.assignToMe(today);
  await app.maintenance.addCost({ kind: "Quotation", description: "Replace trap and seal", amount: "2500", supplier: "Westlands Plumbers" });
  await app.maintenance.approveQuote();
  await app.maintenance.moveTo("Start work", "In progress");
  await app.maintenance.addUpdate("Plumber visited, waiting for a part.", true);
  await app.maintenance.addUpdate("The plumber comes back tomorrow at 10am with the part.");
  await shot(page, "33-maintenance", { fullPage: true });
  await phone.reload();
  await expect(t.text("The plumber comes back tomorrow at 10am with the part.")).toBeVisible();
  await tenantApp.messageLandlord("Thanks, someone will be home.");
  await shot(phone, "34-tenant-repair-update", { fullPage: true });
  await page.reload();
  await app.maintenance.moveTo("Mark resolved", "Resolved");
  await app.maintenance.moveTo("Close", "Closed");
  await shot(page, "35-maintenance-closed");

  // --- 9. Move-out notice ---------------------------------------------------------------------
  await tenantApp.openTab("Move out");
  await t.field("Date you plan to move out").fill(today);
  await t.field("Message (optional)").fill("Relocating to Nakuru for work.");
  await shot(phone, "36-tenant-notice", { fullPage: true, highlight: t.button("Send notice") });
  await t.button("Send notice").click();
  await phone.getByRole("alertdialog").getByRole("button", { name: "Send notice" }).click();
  await t.expectToast("Notice sent to your landlord");
  await app.moveOut.open(tenant.name);
  await shot(page, "37-notice-new", { highlight: ui.button("Acknowledge") });
  await app.moveOut.acknowledge("Confirmed by phone.");
  await app.properties.open("Riverside Apartments");
  await expect(app.properties.unitTile("R1", "Notice submitted")).toBeVisible();
  await shot(page, "38-unit-notice-submitted", { highlight: app.properties.unitTile("R1", "Notice submitted") });

  // --- 10. Inspection -------------------------------------------------------------------------
  await app.moveOut.open(tenant.name);
  await ui.button("Schedule inspection").click();
  await ui.field("Date").fill(today);
  await shot(page, "39-schedule-inspection", { target: dialog, highlight: dialog.getByRole("button", { name: "Schedule" }) });
  await dialog.getByRole("button", { name: "Schedule" }).click();
  await ui.expectToast("Inspection scheduled");
  await tenantApp.expectNoticeStatus("Inspection scheduled");
  await shot(phone, "40-tenant-notice-steps", { fullPage: true });
  await app.moveOut.openInspection();
  const conditions = page.getByRole("combobox", { name: / condition$/ }).filter({ visible: true });
  for (let i = 0, n = await conditions.count(); i < n; i++) await conditions.nth(i).selectOption({ label: "Good" });
  await ui.field("Windows condition", true).first().selectOption({ label: "Damaged" });
  await ui.field("Windows notes", true).first().fill("Window pane cracked");
  await ui.field("Windows charge", true).first().fill("3000");
  await ui.field("Windows condition", true).first().scrollIntoViewIfNeeded();
  await shot(page, "41-checklist", { highlight: ui.field("Windows charge", true) });
  await ui.button("Save checklist").click();
  await ui.expectToast("Checklist saved");
  await ui.button("Complete", true).click();
  await ui.field("Keys returned (optional)").fill("2");
  await ui.field("Tenant was present").check();
  await ui.field("Tenant signature (optional)").fill(tenant.name);
  await ui.field("Inspector signature").fill(landlord.name);
  await shot(page, "42-complete-inspection", { target: dialog, highlight: dialog.getByRole("button", { name: "Complete inspection" }) });
  await dialog.getByRole("button", { name: "Complete inspection" }).click();
  await ui.expectToast("Inspection completed");

  // --- 11. Settlement -------------------------------------------------------------------------
  await app.moveOut.open(tenant.name);
  await app.moveOut.expectSettlement({ "Refund to tenant": "2,000", "Balance still owed after": "0" });
  await ui.field(/^Unit .* becomes$/).selectOption({ label: "Available" });
  await ui.field("Refund paid by").selectOption({ label: "M-Pesa" });
  await ui.field("Refund reference (optional)").fill("QA2000REF");
  await shot(page, "43-settlement", { fullPage: true, highlight: ui.button("Complete move-out") });
  await ui.button("Complete move-out").click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Complete move-out" }).click();
  await ui.expectToast("Move-out completed");
  await expect(ui.text("Final settlement")).toBeVisible();
  await shot(page, "44-final-settlement", { highlight: ui.text("Moved out", true) });

  // --- 12. End state --------------------------------------------------------------------------
  await app.lease.open(leaseUrl);
  await app.lease.expectStatus("Ended");
  await shot(page, "45-lease-ended", { fullPage: true });
  await app.properties.open("Riverside Apartments");
  await shot(page, "46-unit-available", { highlight: app.properties.unitTile("R1", "Available") });
  await tenantApp.openTab("Home");
  await expect(t.text("You're all paid up. Thank you!")).toBeVisible();
  await shot(phone, "47-tenant-paid-up", { fullPage: true });
  await tenantApp.expectNoticeStatus("Moved out");
  await shot(phone, "48-tenant-moved-out", { fullPage: true });
  await ui.openFromSidebar("Audit log");
  await shot(page, "49-audit-log");

  // --- Extra: a tenant moving in mid-month (charge the first month in full) ----------------------
  await ui.openFromSidebar("Tenants");
  await ui.button("Register tenant").first().click();
  await ui.field("Full name").fill("Josephat Mwangi");
  await ui.field("Phone", true).fill("0733 111 222");
  await ui.button("Register tenant").last().click();
  await expect(ui.heading("Josephat Mwangi")).toBeVisible();
  await ui.link("New lease").click();
  await propertySelect.selectOption({ label: (await propertySelect.locator("option", { hasText: "Riverside Apartments" }).textContent())! });
  // R1's last tenancy ends today, so Josephat moves into R2.
  await ui.field("Unit", true).selectOption({ index: 2 });
  await ui.field(/Monthly rent/).fill("13000");
  await ui.field("Start date", true).fill(midMonth);
  await ui.button("Create lease").click();
  await expect(ui.heading(/^LSE-\d+$/)).toBeVisible();
  const row = page.locator("dl > div", { hasText: "First month" });
  await shot(page, "50-first-month-row", { highlight: row.getByRole("button", { name: "Change" }) });
  await row.getByRole("button", { name: "Change" }).click();
  await shot(page, "51-first-month-confirm", { target: page.getByRole("alertdialog") });
  await page.getByRole("alertdialog").getByRole("button", { name: "Charge in full" }).click();
  await ui.expectToast("First month billing updated");
  await expect(row).toContainText("Charged in full");
  await ui.openFromSidebar("Billing");
  await ui.button("Generate invoices").click();
  await ui.field("Month").fill(month(0));
  await ui.button("Preview").click();
  await expect(dialog.getByText("(first month charged in full)").first()).toBeVisible();
  await shot(page, "52-first-month-preview", { target: dialog });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // Publish a vacant unit, so the Listings tab has a live listing in the tour.
  await ui.openFromSidebar("Listings");
  await ui.button("New listing").click();
  await dialog.getByLabel("Property").selectOption({ label: "Riverside Apartments" });
  await dialog.getByLabel("Unit", { exact: true }).selectOption({ label: "R3 · available" });
  await dialog.getByLabel("Title").fill("Bright 1-bedroom in Westlands");
  await dialog.getByLabel("Description").fill("Quiet unit with a balcony. Borehole water and parking.");
  await dialog.getByRole("button", { name: "Save listing" }).click();
  await ui.expectToast("Listing is live");

  // --- Reference: every tab in the landlord's sidebar, now that there is data in it -----------
  const tour: [label: string, name: string, prepare?: () => Promise<unknown>][] = [
    ["Overview", "tab-overview"],
    ["Properties", "tab-properties"],
    ["Units", "tab-units"],
    ["Tenants", "tab-tenants"],
    ["Leases", "tab-leases"],
    ["Maintenance", "tab-maintenance", () => ui.field("View").selectOption("all")],
    ["Inspections", "tab-inspections", () => ui.field("Status").selectOption("")],
    ["Move-outs", "tab-move-outs", () => ui.field("View").selectOption("all")],
    ["Listings", "tab-listings"],
    ["Communications", "tab-communications"],
    ["Billing", "tab-billing", () => page.getByRole("tab", { name: "Invoices" }).click()],
    ["Payments", "tab-payments"],
    ["Reports", "tab-reports", () => ui.field("Period").selectOption({ label: "This year" })],
    ["Utilities", "tab-utilities"],
    ["Charges", "tab-charges"],
    ["Payment settings", "tab-payment-settings"],
    ["Team", "tab-team"],
    ["Audit log", "tab-audit-log"],
    ["Organization", "tab-organization"],
    ["Subscription", "tab-subscription"],
    ["My account", "tab-my-account"],
  ];
  for (const [label, name, prepare] of tour) {
    await ui.openFromSidebar(label);
    // Page headings match the sidebar label, except these two.
    const heading = { Overview: "Riverside Lettings", Organization: "Organization settings" }[label] ?? label;
    await expect(ui.heading(heading).first()).toBeVisible();
    await prepare?.();
    await page.waitForTimeout(400); // let lists load after a filter change
    await shot(page, name);
  }
  // The header: notifications and the account menu.
  await page.getByRole("button", { name: /^Notifications/ }).click();
  await shot(page, "tab-bell", { target: page.getByRole("menu") });
  await page.keyboard.press("Escape");
  await ui.button("Open account menu").click();
  await shot(page, "tab-account-menu", { target: page.getByRole("menu") });
  await page.keyboard.press("Escape");
});
